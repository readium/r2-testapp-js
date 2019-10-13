// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { IStore } from "./store";

import ElectronStore = require("electron-store");

export interface ConfStoreType {
    [key: string]: any;
}

export class StoreElectron implements IStore {
    private _electronStore: ElectronStore<ConfStoreType>;

    constructor(name: string, readonly defaults: any) {
        this._electronStore = new ElectronStore({
            defaults,
            name,
        });
        (this._electronStore as any).events.setMaxListeners(0);
    }

    public getDefaults(): any {
        return this.defaults;
    }

    public get(key: string): any {
        return this._electronStore.get(key);
    }

    public set(key: string | undefined, value: any) {
        if (key) {
            this._electronStore.set(key, value);
        } else {
            this._electronStore.set(value);
        }
    }

    public onChanged(key: string, callback: (newValue: any, oldValue: any) => void): void {
        (this._electronStore as any).onDidChange(key, callback);
    }

    public reveal() {
        this._electronStore.openInEditor();
    }
}
