import { BigInt, log } from '@graphprotocol/graph-ts';
import { PairCreated } from '../../generated/UniswapFactory/Factory';
import { Pair as PairTemplate } from '../../generated/templates/UniswapPair/Pair';
import { fetchTokenSymbol, fetchTokenDecimals } from '../helpers';
import { Token, UniswapPair as Pair, UniswapFactory } from '../../generated/schema';

export const FACTORY_ADDRESS = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

export function handleNewPair(event: PairCreated): void {
    // load factory (create if first exchange)
    let factory = UniswapFactory.load(FACTORY_ADDRESS);
    if (factory == null) {
        factory = new UniswapFactory(FACTORY_ADDRESS);
        factory.pairCount = 0;
    }
    factory.pairCount = factory.pairCount + 1;
    factory.save();

    // create the tokens
    let token0 = Token.load(event.params.token0.toHexString());
    let token1 = Token.load(event.params.token1.toHexString());

    // fetch info if null
    if (token0 == null) {
        token0 = new Token(event.params.token0.toHexString());
        token0.symbol = fetchTokenSymbol(event.params.token0);
        let decimals = fetchTokenDecimals(event.params.token0);
        // bail if we couldn't figure out the decimals
        if (decimals === null) {
            log.debug('mybug the decimal on token 0 was null', []);
            return;
        }
        token0.decimals = decimals;
        token0.totalVolume = BigInt.fromI32(0);
    }

    // fetch info if null
    if (token1 == null) {
        token1 = new Token(event.params.token1.toHexString());
        token1.symbol = fetchTokenSymbol(event.params.token1);
        let decimals = fetchTokenDecimals(event.params.token1);
        // bail if we couldn't figure out the decimals
        if (decimals === null) {
            return;
        }
        token1.decimals = decimals;
        token1.totalVolume = BigInt.fromI32(0);
    }

    let pair = new Pair(event.params.pair.toHexString()) as Pair;
    pair.token0 = token0.id;
    pair.token1 = token1.id;
    pair.createdAtTimestamp = event.block.timestamp;
    pair.createdAtBlockNumber = event.block.number;

    // create the tracked contract based on the template
    PairTemplate.bind(event.params.pair);

    // save updated values
    token0.save();
    token1.save();
    pair.save();
    factory.save();
}
