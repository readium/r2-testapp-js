import { IDeviceIDManager } from "@r2-lcp-js/lsd/deviceid-manager";
import { lsdRenew } from "@r2-lcp-js/lsd/renew";
import { lsdReturn } from "@r2-lcp-js/lsd/return";
import { Server } from "@r2-streamer-js/http/server";
import * as debug_ from "debug";
import { ipcMain } from "electron";
import * as moment from "moment";

import {
    R2_EVENT_LCP_LSD_RENEW,
    R2_EVENT_LCP_LSD_RENEW_RES,
    R2_EVENT_LCP_LSD_RETURN,
    R2_EVENT_LCP_LSD_RETURN_RES,
} from "../common/events";

const debug = debug_("r2:electron:main:lsd");

export function installLsdHandler(publicationsServer: Server, deviceIDManager: IDeviceIDManager) {

    ipcMain.on(R2_EVENT_LCP_LSD_RETURN, async (event: any, publicationFilePath: string) => {

        const publication = publicationsServer.cachedPublication(publicationFilePath);
        if (!publication || !publication.LCP || !publication.LCP.LSDJson) {
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, false, "Internal error!");
            return;
        }

        let renewResponseJson: any;
        try {
            renewResponseJson = await lsdReturn(publication.LCP.LSDJson, deviceIDManager);
            publication.LCP.LSDJson = renewResponseJson;
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, true, "Returned.");
            return;
        } catch (err) {
            debug(err);
            event.sender.send(R2_EVENT_LCP_LSD_RETURN_RES, false, err);
        }
    });

    ipcMain.on(R2_EVENT_LCP_LSD_RENEW, async (event: any, publicationFilePath: string, endDateStr: string) => {
        const publication = publicationsServer.cachedPublication(publicationFilePath);
        if (!publication || !publication.LCP || !publication.LCP.LSDJson) {
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, false, "Internal error!");
            return;
        }

        const endDate = endDateStr.length ? moment(endDateStr).toDate() : undefined;
        let renewResponseJson: any;
        try {
            renewResponseJson = await lsdRenew(endDate, publication.LCP.LSDJson, deviceIDManager);
            publication.LCP.LSDJson = renewResponseJson;
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, true, "Renewed.");
            return;
        } catch (err) {
            debug(err);
            event.sender.send(R2_EVENT_LCP_LSD_RENEW_RES, false, err);
        }
    });
}
