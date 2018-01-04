import * as fs from "fs";

import { Publication } from "@models/publication";
import { LCP } from "@r2-lcp-js/parser/epub/lcp";
import { injectBufferInZip } from "@utils/zip/zipInjector";
import * as debug_ from "debug";
import { JSON as TAJSON } from "ta-json";

const debug = debug_("r2:electron:main:lsd");

export async function lsdLcpUpdateInject(
    lcplStr: string,
    publication: Publication,
    publicationPath: string): Promise<string> {

    const lcplJson = global.JSON.parse(lcplStr);
    debug(lcplJson);

    const zipEntryPath = "META-INF/license.lcpl";

    let lcpl: LCP;
    try {
        lcpl = TAJSON.deserialize<LCP>(lcplJson, LCP);
    } catch (erorz) {
        return Promise.reject(erorz);
    }
    lcpl.ZipPath = zipEntryPath;
    lcpl.JsonSource = lcplStr;
    lcpl.init();
    publication.LCP = lcpl;
    // publication.AddLink("application/vnd.readium.lcp.license-1.0+json", ["license"],
    //     lcpl.ZipPath, false);

    return new Promise<any>(async (resolve, reject) => {
        const newPublicationPath = publicationPath + ".new";
        injectBufferInZip(publicationPath, newPublicationPath, Buffer.from(lcplStr, "utf8"), zipEntryPath,
            (err) => {
                reject(err);
            },
            () => {
                debug("EPUB license.lcpl injected.");

                setTimeout(() => {
                    fs.unlinkSync(publicationPath);
                    setTimeout(() => {
                        fs.renameSync(newPublicationPath, publicationPath);
                        resolve(publicationPath);
                    }, 500);
                }, 500);
            });
    });
}
