import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { ERC20 } from "../generated/ITransformERC20/ERC20";
import { ERC20SymbolBytes } from "../generated/ITransformERC20/ERC20SymbolBytes";
import { IERC20BridgeSampler } from "../generated/ITransformERC20/IERC20BridgeSampler";
import { TransformedERC20 } from "../generated/ITransformERC20/ITransformERC20";
import { Fill, FillComparison, Token, Transaction } from "../generated/schema";

const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const SAMPLER_ADDRESS = "0xd8c38704c9937ea3312de29f824b4ad3450a5e61";
const sampler = IERC20BridgeSampler.bind(Address.fromString(SAMPLER_ADDRESS));

export function handleTransformedERC20(event: TransformedERC20): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString());
    if (transaction === null) {
        transaction = new Transaction(event.transaction.hash.toHexString());
        transaction.timestamp = event.block.timestamp;
        transaction.blockNumber = event.block.number;
        transaction.fills = [];
    }

    let inputToken = Token.load(event.params.inputToken.toHexString());
    let outputToken = Token.load(event.params.outputToken.toHexString());
    if (inputToken === null) {
        inputToken = new Token(event.params.inputToken.toHexString());
        inputToken.symbol = fetchTokenSymbol(event.params.inputToken);
        inputToken.decimals = fetchTokenDecimals(event.params.inputToken);
        inputToken.totalVolume = BigInt.fromI32(0);
    }
    if (outputToken === null) {
        outputToken = new Token(event.params.outputToken.toHexString());
        outputToken.symbol = fetchTokenSymbol(event.params.outputToken);
        outputToken.decimals = fetchTokenDecimals(event.params.outputToken);
        outputToken.totalVolume = BigInt.fromI32(0);
    }
    inputToken.totalVolume = event.params.inputTokenAmount.plus(
        inputToken.totalVolume
    );
    outputToken.totalVolume = event.params.outputTokenAmount.plus(
        outputToken.totalVolume
    );
    inputToken.save();
    outputToken.save();

    let fill = new Fill(
        event.transaction.hash.toHex() + "-" + event.logIndex.toString()
    );
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.taker;
    fill.inputToken = inputToken.id;
    fill.inputTokenAmount = event.params.inputTokenAmount;
    fill.outputToken = outputToken.id;
    fill.outputTokenAmount = event.params.outputTokenAmount;

    fill.comparisons = [];
    let comparisons = fill.comparisons;
    //comparisons.push(
    //    createComparison(
    //        "Uniswap",
    //        normalizeTokenAddress(event.params.inputToken),
    //        normalizeTokenAddress(event.params.outputToken),
    //        event.params.inputTokenAmount,
    //        event
    //    )
    //);
    //comparisons.push(
    //    createComparison(
    //        "UniswapV2",
    //        normalizeTokenAddress(event.params.inputToken),
    //        normalizeTokenAddress(event.params.outputToken),
    //        event.params.inputTokenAmount,
    //        event
    //    )
    //);
    //comparisons.push(
    //    createComparison(
    //        "Kyber",
    //        normalizeTokenAddress(event.params.inputToken),
    //        normalizeTokenAddress(event.params.outputToken),
    //        event.params.inputTokenAmount,
    //        event
    //    )
    //);
    //comparisons.push(
    //    createComparison(
    //        "Eth2Dai",
    //        normalizeTokenAddress(event.params.inputToken),
    //        normalizeTokenAddress(event.params.outputToken),
    //        event.params.inputTokenAmount,
    //        event
    //    )
    //);
    fill.comparisons = comparisons;
    fill.save();

    // Because we gotta make it dirty
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}

function normalizeTokenAddress(token: Address): Address {
    if (token.toHexString() == "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee") {
        return Address.fromString(WETH_ADDRESS);
    }
    return token;
}

function createComparison(
    source: string,
    takerToken: Address,
    makerToken: Address,
    takerAmount: BigInt,
    event: ethereum.Event
): string {
    let outputAmount = BigInt.fromI32(0);
    if (source == "Uniswap") {
        outputAmount = sampler.sampleSellsFromUniswap(takerToken, makerToken, [
            takerAmount,
        ])[0];
    } else if (source == "UniswapV2") {
        outputAmount = sampler.sampleSellsFromUniswapV2(
            [takerToken, makerToken],
            [takerAmount]
        )[0];
    } else if (source == "Kyber") {
        outputAmount = sampler.sampleSellsFromKyberNetwork(
            takerToken,
            makerToken,
            [takerAmount]
        )[0];
    } else if (source == "Eth2Dai") {
        outputAmount = sampler.sampleSellsFromEth2Dai(takerToken, makerToken, [
            takerAmount,
        ])[0];
    }
    const comparison = new FillComparison(
        event.transaction.hash.toHex() +
            "-" +
            event.logIndex.toString() +
            "-" +
            source
    );
    comparison.source = source;
    comparison.outputTokenAmount = outputAmount;
    comparison.save();
    return comparison.id;
}

// https://github.com/Uniswap/uniswap-v2-subgraph/blob/master/src/mappings/helpers.ts
export function isNullEthValue(value: string): boolean {
    return (
        value ==
        "0x0000000000000000000000000000000000000000000000000000000000000001"
    );
}

export function fetchTokenSymbol(tokenAddress: Address): string {
    if (
        tokenAddress.toHexString() ==
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ) {
        return "ETH";
    }
    let contract = ERC20.bind(tokenAddress);
    let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress);
    // try types string and bytes32 for symbol
    let symbolValue = "unknown";
    let symbolResult = contract.try_symbol();
    if (symbolResult.reverted) {
        let symbolResultBytes = contractSymbolBytes.try_symbol();
        if (!symbolResultBytes.reverted) {
            // for broken pairs that have no symbol function exposed
            if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
                symbolValue = symbolResultBytes.value.toString();
            }
        }
    } else {
        symbolValue = symbolResult.value;
    }

    return symbolValue;
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
    if (
        tokenAddress.toHexString() ==
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ) {
        return BigInt.fromI32(18);
    }
    let contract = ERC20.bind(tokenAddress);
    // try types uint8 for decimals
    let decimalValue = null;
    let decimalResult = contract.try_decimals();
    if (!decimalResult.reverted) {
        decimalValue = decimalResult.value;
    }
    return BigInt.fromI32(decimalValue as i32);
}
