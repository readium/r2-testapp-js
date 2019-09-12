// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

import { ipcRenderer } from "electron";

import {
    IEventPayload_R2_EVENT_OPEN_URL_OR_PATH, R2_EVENT_OPEN_URL_OR_PATH,
} from "../common/events";

export function setupDragDrop() {
    window.document.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        return false;
    }, false);

    window.document.addEventListener("drop", (ev: DragEvent) => {
        ev.preventDefault();

        if (!ev.dataTransfer) {
            return;
        }

        let urlOrPath: string | undefined;
        if (ev.dataTransfer.items) {
            for (const item of ev.dataTransfer.items) {
                if (item.kind === "file") {
                    const file = item.getAsFile();
                    if (file) {
                        console.log(file.name);
                        console.log(file.path);
                        urlOrPath = file.path;
                        break;
                    }
                } else if (item.kind === "string") {
                    if (item.type === "text/plain") { // text/uri-list text/html
                        const data = ev.dataTransfer.getData(item.type);
                        console.log(data);
                        urlOrPath = data;
                    } else {
                        console.log(item.type);
                        console.log(ev.dataTransfer.getData(item.type));
                    }
                } else {
                    console.log(item.kind);
                }
            }
        } else if (ev.dataTransfer.files) {
            for (const file of ev.dataTransfer.files) {
                console.log(file.name);
                console.log(file.path);
                urlOrPath = file.path;
                break;
            }
        }

        if (urlOrPath) {
            const payload: IEventPayload_R2_EVENT_OPEN_URL_OR_PATH = {
                urlOrPath,
            };
            ipcRenderer.send(R2_EVENT_OPEN_URL_OR_PATH, payload);
        }
    }, false);
}
