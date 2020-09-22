import { Address, BigInt } from '@graphprotocol/graph-ts';
import { Swap } from '../../generated/templates/UniswapPair/Pair';
import { Fill, Transaction, Token, UniswapPair as Pair } from '../../generated/schema';

const EXCHANGE_PROXY_ADDRESS = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';

export function handleSwap(event: Swap): void {
    if (event.params.sender !== Address.fromString(EXCHANGE_PROXY_ADDRESS)) {
        return;
    }
    let transaction = Transaction.load(event.transaction.hash.toHexString());
    if (transaction === null) {
        transaction = new Transaction(event.transaction.hash.toHexString());
        transaction.timestamp = event.block.timestamp;
        transaction.blockNumber = event.block.number;
        transaction.fills = [];
    }

    // instantiate the fill
    let fill = new Fill(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.to;
    fill.comparisons = [];
    fill.source = "UniswapV2"; // enum FillSource

    // summarize input and output amounts
    let pair = Pair.load(event.address.toHexString());
    let token0 = Token.load(pair.token0);
    let token1 = Token.load(pair.token1);
    let amount0Out = event.params.amount0Out;
    let amount0In = event.params.amount0In;
    let amount1Out = event.params.amount1Out;
    let amount1In = event.params.amount1In;

    if (amount0Out > BigInt.fromI32(0) && amount1Out === BigInt.fromI32(0)) {
        fill.outputToken = token0.id;
        fill.outputTokenAmount = amount0Out;
        fill.inputToken = token1.id;
        fill.inputTokenAmount = amount1In;
    } else if (amount1Out > BigInt.fromI32(0) && amount0Out === BigInt.fromI32(0)) {
        fill.outputToken = token1.id;
        fill.outputTokenAmount = amount1Out;
        fill.inputToken = token0.id;
        fill.inputTokenAmount = amount0In;
    } else {
        // this should never happen
        return;
    }

    // save the fill
    fill.save();

    // update total volume for tokens
    token0.totalVolume = amount0Out.plus(amount0In).plus(token0.totalVolume);
    token1.totalVolume = amount1Out.plus(amount1In).plus(token1.totalVolume);
    token0.save();
    token1.save();

    // update the transaction
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}
