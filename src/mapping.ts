import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts';
import { LiquidityProviderSwap } from '../generated/ILiquidityProviderFeature/LiquidityProviderFeature';
import { TransformedERC20 } from '../generated/ITransformERC20/ITransformERC20';
import { Fill, FirstIntermediateFill, Token, Transaction } from '../generated/schema';
import { Pair, Swap } from '../generated/templates/UniswapPair/Pair';
import { fetchTokenDecimals, fetchTokenSymbol } from './helpers';

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

export function handleTransformedERC20(event: TransformedERC20): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString());
    if (transaction === null) {
        transaction = new Transaction(event.transaction.hash.toHexString());
        transaction.timestamp = event.block.timestamp;
        transaction.blockNumber = event.block.number;
        transaction.fills = [];
    }

    let inputToken = _tokenFindOrCreate(event.params.inputToken);
    let outputToken = _tokenFindOrCreate(event.params.outputToken);

    inputToken.totalVolume = event.params.inputTokenAmount.plus(inputToken.totalVolume);
    outputToken.totalVolume = event.params.outputTokenAmount.plus(outputToken.totalVolume);
    inputToken.save();
    outputToken.save();

    let fill = new Fill(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.taker;
    fill.inputToken = inputToken.id;
    fill.inputTokenAmount = event.params.inputTokenAmount;
    fill.outputToken = outputToken.id;
    fill.outputTokenAmount = event.params.outputTokenAmount;
    fill.source = 'ExchangeProxy'; // enum FillSource

    fill.comparisons = [];
    let comparisons = fill.comparisons;
    fill.comparisons = comparisons;
    fill.save();

    // Because we gotta make it dirty
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}

function normalizeTokenAddress(token: Address): Address {
    if (token.toHexString() == '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        return Address.fromString(WETH_ADDRESS);
    }
    return token;
}

const EXCHANGE_PROXY_ADDRESS = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';
const UNISWAP_V2_FACTORY_ADDRESS = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f';
const SUSHISWAP_FACTORY_ADDRESS = '0xc0aee478e3658e2610c5f7a4a2e1777ce9e4f2ac';

export function handleGenericSwap(event: Swap): void {
    if (event.params.sender.toHexString() != EXCHANGE_PROXY_ADDRESS) {
        return;
    }

    let transaction = Transaction.load(event.transaction.hash.toHexString());
    if (transaction === null) {
        transaction = new Transaction(event.transaction.hash.toHexString());
        transaction.timestamp = event.block.timestamp;
        transaction.blockNumber = event.block.number;
        transaction.fills = [];
    }

    // See if the address which emitted the swap event has a factory getter
    let pair = Pair.bind(event.address);
    let pairFactoryResult = pair.try_factory();
    if (pairFactoryResult.reverted || pairFactoryResult.value == null) {
        log.error('Unable to detect Uniswap like pair (no factory) {}', [event.address.toHexString()]);
        return;
    }
    let token0Result = pair.try_token0();
    let token1Result = pair.try_token1();
    // If we cannot decode the tokens in the pair, bail
    if (token0Result.reverted || token1Result.reverted || token0Result.value == null || token1Result.value == null) {
        log.error('Unable to detect Uniswap like pair (no token0/1) {}', [event.address.toHexString()]);
        return;
    }

    // If the recipient (to) is another Pair then this is a multi path swap
    // we store the first half of the trade for later processing of subsequent Swap events
    let toPair = Pair.bind(event.params.to);
    let toPairFactoryResult = toPair.try_factory();
    let isSwapAnIntermediateHop =
        !toPairFactoryResult.reverted &&
        (toPairFactoryResult.value.toHexString() == UNISWAP_V2_FACTORY_ADDRESS ||
            toPairFactoryResult.value.toHexString() == SUSHISWAP_FACTORY_ADDRESS);
    // Store the hop swap details for later, we only need to keep the input
    if (isSwapAnIntermediateHop) {
        let _firstHop = FirstIntermediateFill.load('1') || new FirstIntermediateFill('1');
        _firstHop.inputToken =
            event.params.amount0Out > BigInt.fromI32(0)
                ? _tokenFindOrCreate(token1Result.value).id
                : _tokenFindOrCreate(token0Result.value).id;
        _firstHop.inputTokenAmount =
            event.params.amount0Out > BigInt.fromI32(0) ? event.params.amount1In : event.params.amount0In;
        _firstHop.save();
        return;
    }

    // instantiate the fill
    let fill = new Fill(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.to;
    fill.comparisons = [];

    if (event.params.amount0Out > BigInt.fromI32(0)) {
        fill.outputToken = _tokenFindOrCreate(token0Result.value).id;
        fill.outputTokenAmount = event.params.amount0Out;
        fill.inputToken = _tokenFindOrCreate(token1Result.value).id;
        fill.inputTokenAmount = event.params.amount1In;
    } else if (event.params.amount1Out > BigInt.fromI32(0)) {
        fill.outputToken = _tokenFindOrCreate(token1Result.value).id;
        fill.outputTokenAmount = event.params.amount1Out;
        fill.inputToken = _tokenFindOrCreate(token0Result.value).id;
        fill.inputTokenAmount = event.params.amount0In;
    } else {
        // this should never happen
        log.error('UNISWAPV2: Swap event has invalid amounts, skipping', []);
        return;
    }

    // Override input with the stored first hop iff it exists
    let firstHop = FirstIntermediateFill.load('1');
    if (firstHop != null && firstHop.inputTokenAmount != BigInt.fromI32(0)) {
        fill.inputToken = firstHop.inputToken;
        fill.inputTokenAmount = firstHop.inputTokenAmount;
        // Clear it
        firstHop.inputTokenAmount = BigInt.fromI32(0);
        firstHop.save();
    }

    if (pairFactoryResult.value.toHexString() == UNISWAP_V2_FACTORY_ADDRESS) {
        fill.source = 'UniswapV2';
    } else if (pairFactoryResult.value.toHexString() == SUSHISWAP_FACTORY_ADDRESS) {
        fill.source = 'Sushiswap';
    } else {
        log.info('unknown factory {} {} {}', [
            event.address.toHexString(),
            pairFactoryResult.value.toHexString(),
            UNISWAP_V2_FACTORY_ADDRESS,
            SUSHISWAP_FACTORY_ADDRESS,
        ]);
    }

    // // save the fill
    fill.save();

    // // update the transaction
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}

export function handleLiquidityProviderFeature(event: LiquidityProviderSwap): void {
    let transaction = _transactionFindOrCreate(event);
    let inputToken = _tokenFindOrCreate(event.params.inputToken);
    let outputToken = _tokenFindOrCreate(event.params.outputToken);

    inputToken.totalVolume = event.params.inputTokenAmount.plus(inputToken.totalVolume);
    outputToken.totalVolume = event.params.outputTokenAmount.plus(outputToken.totalVolume);
    inputToken.save();
    outputToken.save();

    let fill = new Fill(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.recipient;
    fill.inputToken = inputToken.id;
    fill.inputTokenAmount = event.params.inputTokenAmount;
    fill.outputToken = outputToken.id;
    fill.outputTokenAmount = event.params.outputTokenAmount;
    fill.source = 'LiquidityProvider'; // enum FillSource

    fill.comparisons = [];
    let comparisons = fill.comparisons;
    fill.comparisons = comparisons;
    fill.save();

    // Because we gotta make it dirty
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}

export function _transactionFindOrCreate(event: ethereum.Event): Transaction {
    let transaction = Transaction.load(event.transaction.hash.toHexString());
    if (transaction == null) {
        transaction = new Transaction(event.transaction.hash.toHexString());
        transaction.timestamp = event.block.timestamp;
        transaction.blockNumber = event.block.number;
        transaction.fills = [];
    }
    transaction.save();
    return transaction!;
}

export function _tokenFindOrCreate(address: Address): Token {
    let token = Token.load(address.toHexString());
    if (token === null) {
        token = new Token(address.toHexString());
        token.symbol = fetchTokenSymbol(address);
        token.decimals = fetchTokenDecimals(address);
        token.totalVolume = BigInt.fromI32(0);
    }
    token.save();
    return token!;
}
