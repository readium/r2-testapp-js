import * as debug_ from "debug";
import * as uuid from "uuid";

import { IDeviceIDManager } from "@r2-lcp-js/lsd/deviceid-manager";

import { IStore } from "../common/store";

const debug = debug_("r2:testapp#electron/main/lsd-deviceid-manager");

const LSD_STORE_DEVICEID_ENTRY_PREFIX = "deviceID_";

export function getDeviceIDManager(electronStoreLSD: IStore, name: string): IDeviceIDManager {

    const deviceIDManager: IDeviceIDManager = {

        checkDeviceID(key: string): string | undefined {

            const entry = LSD_STORE_DEVICEID_ENTRY_PREFIX + key;

            const lsdStore = electronStoreLSD.get("lsd");
            if (!lsdStore || !lsdStore[entry]) {
                return undefined;
            }

            return lsdStore[entry];
        },

        getDeviceID(): string {

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

            return id;
        },

        getDeviceNAME(): string {
            return name;
        },

        recordDeviceID(key: string) {

            const id = this.getDeviceID();

            const lsdStore = electronStoreLSD.get("lsd");
            if (!lsdStore) {
                // Should be init'ed at this.getDeviceID()
                debug("LSD store problem?!");
                return;
            }

            const entry = LSD_STORE_DEVICEID_ENTRY_PREFIX + key;
            lsdStore[entry] = id;
            electronStoreLSD.set("lsd", lsdStore);
        },
    };
    return deviceIDManager;
}
