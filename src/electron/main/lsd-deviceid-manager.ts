// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as debug_ from "debug";
import * as uuid from "uuid";

import { IDeviceIDManager } from "@r2-lcp-js/lsd/deviceid-manager";

import { IStore } from "../common/store";

const debug = debug_("r2:testapp#electron/main/lsd-deviceid-manager");

const LSD_STORE_DEVICEID_ENTRY_PREFIX = "deviceID_";

export function getDeviceIDManager(electronStoreLSD: IStore, name: string): IDeviceIDManager {

    const deviceIDManager: IDeviceIDManager = {

        async checkDeviceID(key: string): Promise<string | undefined> {

            const entry = LSD_STORE_DEVICEID_ENTRY_PREFIX + key;

            const lsdStore = electronStoreLSD.get("lsd");
            if (!lsdStore || !lsdStore[entry]) {
                return Promise.resolve(undefined);
            }

            return Promise.resolve(lsdStore[entry]);
        },

        async getDeviceID(): Promise<string> {

            let id = uuid.v4();

            const lsdStore = electronStoreLSD.get("lsd");
            if (!lsdStore) {
                electronStoreLSD.set("lsd", {
                    deviceID: id,
                });
            } else {
                if (lsdStore.deviceID) {
                    id = lsdStore.deviceID;
                } else {
                    lsdStore.deviceID = id;
                    electronStoreLSD.set("lsd", lsdStore);
                }
            }

            return Promise.resolve(id);
        },

        async getDeviceNAME(): Promise<string> {
            return Promise.resolve(name);
        },

        async recordDeviceID(key: string): Promise<void> {

            const id = this.getDeviceID();

            const lsdStore = electronStoreLSD.get("lsd");
            if (!lsdStore) {
                // Should be init'ed at this.getDeviceID()
                debug("LSD store problem?!");
                return Promise.reject("Cannot get LSD store?");
            }

            const entry = LSD_STORE_DEVICEID_ENTRY_PREFIX + key;
            lsdStore[entry] = id;
            electronStoreLSD.set("lsd", lsdStore);

            return Promise.resolve(); // implicit
        },
    };
    return deviceIDManager;
}
