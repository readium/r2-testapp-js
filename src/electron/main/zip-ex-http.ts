// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { PassThrough } from "stream";

import { IStreamAndLength, IZip, Zip } from "@r2-utils-js/_utils/zip/zip";
import * as debug_ from "debug";
import * as request from "request";
import * as requestPromise from "request-promise-native";

// import { bufferToStream } from "../stream/BufferUtils";

const debug = debug_("r2:testapp#electron/main/zip-ex-manifest-json");

export class ZipExplodedHTTP extends Zip {

    public static async loadPromise(dirPath: string): Promise<IZip> {
        return Promise.resolve(new ZipExplodedHTTP(dirPath));
    }

    private constructor(readonly dirPath: string) {
        super();
        debug(`ZipExplodedHTTP: ${dirPath}`);
    }

    public freeDestroy(): void {
        debug("freeDestroy: ZipExplodedHTTP -- " + this.dirPath);
    }

    public entriesCount(): number {
        return 0; // TODO: hacky! (not really needed ... but still)
    }

    public hasEntries(): boolean {
        return true; // TODO: hacky
    }

    public hasEntry(_entryPath: string): boolean {
        return true; // TODO: hacky
    }

    public async getEntries(): Promise<string[]> {

        return new Promise<string[]>(async (_resolve, reject) => {
            reject("Not implemented.");
        });
    }

    public async entryStreamPromise(entryPath: string): Promise<IStreamAndLength> {

        debug(`entryStreamPromise: ${entryPath}`);

        if (!this.hasEntries() || !this.hasEntry(entryPath)) {
            return Promise.reject("no such path in zip exploded: " + entryPath);
        }
        const url = this.dirPath + "/" + entryPath;

        debug(`URL: ${url}`);

        return new Promise(async (topresolve, topreject) => {

            const failure = async (err: any) => {
                debug(err);
                topreject(err);
            };

            const success = async (response: request.RequestResponse) => {

                Object.keys(response.headers).forEach((header: string) => {
                    debug(header + " => " + response.headers[header]);
                });

                // debug(response);
                // debug(response.body);

                if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
                    await failure("HTTP CODE " + response.statusCode);
                    return;
                }

                let length = 0;
                const lengthStr = response.headers["content-length"];
                if (lengthStr) {
                    length = parseInt(lengthStr, 10);
                }

                const stream = new PassThrough();
                response.pipe(stream);

                const streamAndLength: IStreamAndLength = {
                    length,
                    reset: async () => {
                        return this.entryStreamPromise(entryPath);
                    },
                    stream,
                };
                topresolve(streamAndLength);

                // let responseStr: string;
                // if (response.body) {
                //     debug("RES BODY");
                //     responseStr = response.body;
                // } else {
                //     debug("RES STREAM");
                //     let responseData: Buffer;
                //     try {
                //         responseData = await streamToBufferPromise(response);
                //     } catch (err) {
                //         debug(err);
                //         return;
                //     }
                //     responseStr = responseData.toString("utf8");
                // }
            };

            // No response streaming! :(
            // https://github.com/request/request-promise/issues/90
            const needsStreamingResponse = true;

            if (needsStreamingResponse) {
                const promise = new Promise((resolve, reject) => {
                    request.get({
                        headers: {},
                        method: "GET",
                        uri: url,
                    })
                        .on("response", async (response: request.RequestResponse) => {
                            await success(response);
                            resolve();
                        })
                        .on("error", async (err: any) => {
                            await failure(err);
                            reject();
                        });
                });
                try {
                    await promise;
                } catch (err) {
                    // ignore
                }
            } else {
                let response: requestPromise.FullResponse;
                try {
                    // tslint:disable-next-line:await-promise no-floating-promises
                    response = await requestPromise({
                        headers: {},
                        method: "GET",
                        resolveWithFullResponse: true,
                        uri: url,
                    });
                    await success(response);
                } catch (err) {
                    await failure(err);
                }
            }
        });
    }
}
