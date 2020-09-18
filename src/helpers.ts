import { Address, BigInt } from '@graphprotocol/graph-ts';
import { ERC20 } from '../generated/ITransformERC20/ERC20';
import { ERC20SymbolBytes } from '../generated/ITransformERC20/ERC20SymbolBytes';

export function fetchTokenSymbol(tokenAddress: Address): string {
    if (tokenAddress.toHexString() == '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
        return 'ETH';
    }
    let contract = ERC20.bind(tokenAddress);
    let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress);
    // try types string and bytes32 for symbol
    let symbolValue = 'unknown';
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
    if (tokenAddress.toHexString() == '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
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

// https://github.com/Uniswap/uniswap-v2-subgraph/blob/master/src/mappings/helpers.ts
export function isNullEthValue(value: string): boolean {
    return value == '0x0000000000000000000000000000000000000000000000000000000000000001';
}
