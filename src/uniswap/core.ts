import { BigInt, log } from '@graphprotocol/graph-ts';
import { Swap } from '../../generated/templates/UniswapPair/Pair';
import { Fill, Transaction, UniswapPair as Pair } from '../../generated/schema';

const EXCHANGE_PROXY_ADDRESS = '0xdef1c0ded9bec7f1a1670819833240f027b25eff';

export function handleSwap(event: Swap): void {
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

    // instantiate the fill
    let fill = new Fill(event.transaction.hash.toHex() + '-' + event.logIndex.toString());
    fill.timestamp = event.block.timestamp;
    fill.taker = event.params.to;
    fill.comparisons = [];
    fill.source = 'UniswapV2'; // enum FillSource

    // summarize input and output amounts
    let pair = Pair.load(event.address.toHexString());

    if (event.params.amount0Out > BigInt.fromI32(0)) {
        fill.outputToken = pair.token0;
        fill.outputTokenAmount = event.params.amount0Out;
        fill.inputToken = pair.token1;
        fill.inputTokenAmount = event.params.amount1In;
    } else if (event.params.amount1Out > BigInt.fromI32(0)) {
        fill.outputToken = pair.token1;
        fill.outputTokenAmount = event.params.amount1Out;
        fill.inputToken = pair.token0;
        fill.inputTokenAmount = event.params.amount0In;
    } else {
        // this should never happen
        log.error('UNISWAPV2: Swap event has invalid amounts, skipping', []);
        return;
    }

    // save the fill
    fill.save();

    // update the transaction
    let fills = transaction.fills;
    fills.push(fill.id);
    transaction.fills = fills;
    transaction.save();
}
