// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import * as crypto from "crypto";

import { doTryLcpPass } from "@r2-navigator-js/electron/main/lcp";
import { Server } from "@r2-streamer-js/http/server";
import * as debug_ from "debug";
import { ipcMain } from "electron";

import {
    IEventPayload_R2_EVENT_TRY_LCP_PASS,
    IEventPayload_R2_EVENT_TRY_LCP_PASS_RES,
    R2_EVENT_TRY_LCP_PASS,
    R2_EVENT_TRY_LCP_PASS_RES,
} from "../common/events";

const debug = debug_("r2:testapp#electron/main/lcp");

export function installLcpHandler(publicationsServer: Server) {

    ipcMain.on(R2_EVENT_TRY_LCP_PASS, async (
        event: any,
        payload: IEventPayload_R2_EVENT_TRY_LCP_PASS) => {

        // debug(payload.publicationFilePath);
        // debug(payload.lcpPass);

        // let passSha256Hex: string;
        try {
            // passSha256Hex =
            await doTryLcpPass(publicationsServer,
                payload.publicationFilePath,
                [payload.lcpPass],
                payload.isSha256Hex);
            let passSha256Hex: string | undefined; // = lcpPass
            if (!payload.isSha256Hex) {
                const checkSum = crypto.createHash("sha256");
                checkSum.update(payload.lcpPass);
                passSha256Hex = checkSum.digest("hex");
                // const lcpPass64 = new Buffer(hash).toString("base64");
                // const lcpPassHex = new Buffer(lcpPass64, "base64").toString("utf8");
            } else {
                passSha256Hex = payload.lcpPass;
            }
            const payloadRes: IEventPayload_R2_EVENT_TRY_LCP_PASS_RES = {
                error: undefined,
                okay: true,
                passSha256Hex,
            };
            event.sender.send(R2_EVENT_TRY_LCP_PASS_RES, payloadRes);
        } catch (err) {
            debug(err);
            const payloadRes: IEventPayload_R2_EVENT_TRY_LCP_PASS_RES = {
                error: err,
                okay: false,
                passSha256Hex: undefined,
            };
            event.sender.send(R2_EVENT_TRY_LCP_PASS_RES, payloadRes);

            // DRMErrorCode (from r2-lcp-client)
            // 1 === NO CORRECT PASSPHRASE / UERKEY IN GIVEN ARRAY
            //     // No error
            //     NONE = 0,
            //     /**
            //         WARNING ERRORS > 10
            //     **/
            //     // License is out of date (check start and end date)
            //     LICENSE_OUT_OF_DATE = 11,
            //     /**
            //         CRITICAL ERRORS > 100
            //     **/
            //     // Certificate has been revoked in the CRL
            //     CERTIFICATE_REVOKED = 101,
            //     // Certificate has not been signed by CA
            //     CERTIFICATE_SIGNATURE_INVALID = 102,
            //     // License has been issued by an expired certificate
            //     LICENSE_SIGNATURE_DATE_INVALID = 111,
            //     // License signature does not match
            //     LICENSE_SIGNATURE_INVALID = 112,
            //     // The drm context is invalid
            //     CONTEXT_INVALID = 121,
            //     // Unable to decrypt encrypted content key from user key
            //     CONTENT_KEY_DECRYPT_ERROR = 131,
            //     // User key check invalid
            //     USER_KEY_CHECK_INVALID = 141,
            //     // Unable to decrypt encrypted content from content key
            //     CONTENT_DECRYPT_ERROR = 151
        }
    });
}
