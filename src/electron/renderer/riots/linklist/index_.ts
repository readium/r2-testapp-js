// ==LICENSE-BEGIN==
// Copyright 2017 European Digital Reading Lab. All rights reserved.
// Licensed to the Readium Foundation under one or more contributor license agreements.
// Use of this source code is governed by a BSD-style license
// that can be found in the LICENSE file exposed on Github (readium) in the project repository.
// ==LICENSE-END==

// http://riotjs.com/guide/
// http://riotjs.com/api/

export interface IRiotOptsLinkListItem {
    href: string;
    title: string;
}
export interface IRiotOptsLinkList {
    basic: boolean;
    handleLink: (href: string) => void;
    links: IRiotOptsLinkListItem[];
    url: string;
}

export interface IRiotTagLinkList extends
    // IRiotOptsLinkList,
    RiotTag { // RiotMixinWithRecursivePropertySetter
    setBasic: (basic: boolean) => void;
}

export const riotMountLinkList = (selector: string, opts: IRiotOptsLinkList): RiotTag[] => {
    const tag = riot.mount(selector, opts);
    // console.log(tag); // RiotTag[]
    return tag;
};

// tslint:disable-next-line:space-before-function-paren
(window as any).riot_linklist = function (_opts: IRiotOptsLinkList) {

    const that = this as IRiotTagLinkList;

    // tslint:disable-next-line:space-before-function-paren
    that.setBasic = function (basic: boolean) {
        this.opts.basic = basic;
        this.update();
    };

    this.onclick = (ev: RiotEvent) => {
        ev.preventUpdate = true;
        ev.preventDefault();

        const href = (ev.currentTarget as HTMLElement).getAttribute("href");
        if (href) {
            let thiz = this;
            while (!thiz.opts.handleLink && thiz.parent) {
                thiz = thiz.parent;
            }
            thiz.opts.handleLink(new URL(href, thiz.opts.url).toString());
        }
    };
};
