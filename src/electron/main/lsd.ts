import { IDeviceIDManager } from "@r2-lcp-js/lsd/deviceid-manager";
import { doLsdRenew } from "@r2-navigator-js/electron/main/lsd";
import { doLsdReturn } from "@r2-navigator-js/electron/main/lsd";
import { Server } from "@r2-streamer-js/http/server";
import * as debug_ from "debug";
import { ipcMain } from "electron";

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

export function installLsdHandler(publicationsServer: Server, deviceIDManager: IDeviceIDManager) {

    ipcMain.on(R2_EVENT_LCP_LSD_RETURN, async (
        event: any,
        payload: IEventPayload_R2_EVENT_LCP_LSD_RETURN) => {
        let lsdJson: any;
        try {
            lsdJson = await doLsdReturn(publicationsServer, deviceIDManager, payload.publicationFilePath);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES = {
                error: undefined,
                lsdJson,
                okay: true,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, payloadRes);
        } catch (err) {
            debug(err);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RETURN_RES = {
                error: err,
                lsdJson: undefined,
                okay: false,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, payloadRes);
        }
    });

    ipcMain.on(R2_EVENT_LCP_LSD_RENEW, async (
        event: any,
        payload: IEventPayload_R2_EVENT_LCP_LSD_RENEW) => {
        let lsdJson: any;
        try {
            lsdJson = await doLsdRenew(publicationsServer, deviceIDManager,
                payload.publicationFilePath, payload.endDateStr);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES = {
                error: undefined,
                lsdJson,
                okay: true,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, payloadRes);
        } catch (err) {
            debug(err);
            const payloadRes: IEventPayload_R2_EVENT_LCP_LSD_RENEW_RES = {
                error: err,
                lsdJson: undefined,
                okay: false,
            };
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, payloadRes);
        }
    });
}
