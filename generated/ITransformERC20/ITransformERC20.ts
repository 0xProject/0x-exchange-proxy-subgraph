// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.

import {
  ethereum,
  JSONValue,
  TypedMap,
  Entity,
  Bytes,
  Address,
  BigInt
} from "@graphprotocol/graph-ts";

export class TransformedERC20 extends ethereum.Event {
  get params(): TransformedERC20__Params {
    return new TransformedERC20__Params(this);
  }
}

export class TransformedERC20__Params {
  _event: TransformedERC20;

  constructor(event: TransformedERC20) {
    this._event = event;
  }

  get taker(): Address {
    return this._event.parameters[0].value.toAddress();
  }

  get inputToken(): Address {
    return this._event.parameters[1].value.toAddress();
  }

  get outputToken(): Address {
    return this._event.parameters[2].value.toAddress();
  }

  get inputTokenAmount(): BigInt {
    return this._event.parameters[3].value.toBigInt();
  }

  get outputTokenAmount(): BigInt {
    return this._event.parameters[4].value.toBigInt();
  }
}

export class ITransformERC20 extends ethereum.SmartContract {
  static bind(address: Address): ITransformERC20 {
    return new ITransformERC20("ITransformERC20", address);
  }
}
