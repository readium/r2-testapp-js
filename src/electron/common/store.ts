// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

export interface IStore {
    // init(name: string, defaults: any): void;
    getDefaults(): any;
    get(key: string): any;
    set(key: string | undefined, value: any): void;
    onChanged(key: string, callback: (newValue: any, oldValue: any) => void): void;
}
declare var IStore: {
    new (name: string, defaults: any): IStore;
};
