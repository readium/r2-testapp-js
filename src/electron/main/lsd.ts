// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { IDeviceIDManager } from "@r2-lcp-js/lsd/deviceid-manager";
import { LSD } from "@r2-lcp-js/parser/epub/lsd";
import { doLsdRenew } from "@r2-navigator-js/electron/main/lsd";
import { doLsdReturn } from "@r2-navigator-js/electron/main/lsd";
import { Server } from "@r2-streamer-js/http/server";
import * as debug_ from "debug";
import { ipcMain } from "electron";
import { JSON as TAJSON } from "ta-json-x";

import {
    IEventPayload_R2_EVENT_LCP_LSD_RENEW,
    IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES,
    IEventPayload_R2_EVENT_LCP_LSD_RETURN,
    IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES,
    R2_EVENT_LCP_LSD_RENEW,
    R2_EVENT_LCP_LSD_RENEW_RES,
    R2_EVENT_LCP_LSD_RETURN,
    R2_EVENT_LCP_LSD_RETURN_RES,
} from "../common/events";

const debug = debug_("r2:testapp#electron/main/lsd");

const IS_DEV = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "dev");

export function installLsdHandler(publicationsServer: Server, deviceIDManager: IDeviceIDManager) {

    ipcMain.on(R2_EVENT_LCP_LSD_RETURN, async (
        event: any,
        payload: IEventPayload_R2_EVENT_LCP_LSD_RETURN) => {
        let lsdJSON: any;
        try {
            lsdJSON = await doLsdReturn(publicationsServer, deviceIDManager, payload.publicationFilePath);
            let lsd: LSD | undefined;
            try {
                lsd = TAJSON.deserialize<LSD>(lsdJSON, LSD);
                if (IS_DEV) {
                    debug(lsd);
                }
            } catch (err) {
                debug(err);
            }
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES = {
                error: undefined,
                lsd,
                okay: true,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, payloadRes);
        } catch (err) {
            debug(err);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES = {
                error: err,
                lsd: undefined,
                okay: false,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, payloadRes);
        }
    });

    ipcMain.on(R2_EVENT_LCP_LSD_RENEW, async (
        event: any,
        payload: IEventPayload_R2_EVENT_LCP_LSD_RENEW) => {
        let lsdJSON: any;
        try {
            lsdJSON = await doLsdRenew(publicationsServer, deviceIDManager,
                payload.publicationFilePath, payload.endDateStr);
            let lsd: LSD | undefined;
            try {
                lsd = TAJSON.deserialize<LSD>(lsdJSON, LSD);
                if (IS_DEV) {
                    debug(lsd);
                }
            } catch (err) {
                debug(err);
            }
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES = {
                error: undefined,
                lsd,
                okay: true,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, payloadRes);
        } catch (err) {
            debug(err);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES = {
                error: err,
                lsd: undefined,
                okay: false,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, payloadRes);
        }
    });
}
