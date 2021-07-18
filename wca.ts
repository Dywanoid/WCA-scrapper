// deno-lint-ignore-file no-explicit-any
import {DOMParser} from "https://deno.land/x/deno_dom@v0.1.12-alpha/deno-dom-wasm.ts";
import {red, green, blue, yellow, brightCyan} from 'https://deno.land/std@0.101.0/fmt/colors.ts';
import axiod from "https://deno.land/x/axiod@0.21/mod.ts";
import {IAxiodResponse} from "https://deno.land/x/axiod@0.21/interfaces.ts";

const WCA_URL = 'https://www.worldcubeassociation.org/competitions?utf8=%E2%9C%93&region=_Europe&search=&state=present&year=all+years&from_date=&to_date=&delegate=&display=list';
const DISCORD_API_URL = 'https://discord.com/api';
const BOT_TOKEN = await Deno.readTextFile('token.txt').then((text) => text);

const EVENTS_CACHE_FILENAME = 'events.json';
const COUNTRY_NAME = 'Poland';
const CHANNEL_NAME_PART = 'zawody';

const DELAY_VALUE = 1000 * 60 * 15;

interface Events {
    [event: string]: boolean;
}

interface AxiodWrapperOptions {
    method?: 'get' | 'post';
    
    url: string | ((d: any) => string);
    headers?: {
        [key: string]: string;
    },
    
    urlGeneratorData?: any[],
    data?: {
        [key: string]: string;
    },
    injectHeader?: boolean;
}

type DataExtractionFunctionType = (d: any) => any;
type PromiseWrapperType = Promise<Response | IAxiodResponse>;
type PromiseWrapperInput = PromiseWrapperType | PromiseWrapperType[];

const identity = (d: any) => d;

const isPromiseArray = (promise: PromiseWrapperInput): promise is PromiseWrapperType => {
    return !!(<PromiseWrapperType> promise).then;
}

const showError = (msg: string, ...rest: any[]): void => {
    console.log(red(msg), ...rest);
};

const promiseWrapper = async (
    promise: PromiseWrapperInput, 
    dataExtractonFn: DataExtractionFunctionType = identity
): Promise<[any, Error | null]> => {
    try {
        const data = await (isPromiseArray(promise) ? promise.then(dataExtractonFn) : Promise.all(promise).then(dataExtractonFn));
        return [data, null];
    } catch(err) {
        console.log(err);
        return [null, err];
    }
}; 

const axiodWrapper = (dataExtractionFn: DataExtractionFunctionType, options: AxiodWrapperOptions) => {
    const method = options.method ?? 'get';
    const url = options.url ?? '';
    const optionHeaders = options.headers ?? {};
    const injectHeader = options.injectHeader ?? true;
    const headers = {...optionHeaders};

    if(injectHeader) {
        headers.Authorization = `Bot ${BOT_TOKEN}`;
    }

    const data = options.data;
    let axiodPromise;

    if(typeof url !== 'string' && options.urlGeneratorData) {
        axiodPromise = options.urlGeneratorData.map((d) => {
            const generatedUrl = url(d);
            return axiod({
                method,
                url: generatedUrl,
                headers,
                data
            });
        });
    } else {
        axiodPromise = axiod({
            method,
            url: <string> url,
            headers,
            data
        });
    }

    return promiseWrapper(
        axiodPromise,
        dataExtractionFn
    );
};

const sendMessage = async (msg: string) => {
    const [guilds, guildsError] = await axiodWrapper(
        (res) => res.data,
        {
            url: `${DISCORD_API_URL}/users/@me/guilds`
        }
    );
    
    if(guildsError) {
        showError('There was a problem with getting guilds!', guildsError);
        return;
    }

    const [channels, channelsError] = await axiodWrapper(
        (res) => res.reduce((acc: any[], res: any) => acc.concat(...res.data), []),
        {
            url: (d) => `${DISCORD_API_URL}/guilds/${d?.id}/channels`,
            urlGeneratorData: guilds    
        } 
    );

    if(channelsError) {
        showError('There was a problem with getting channels!', channelsError);
        return;
    }

    const channelsToSendMsgTo = channels.filter((channel: any) => channel.name.includes(CHANNEL_NAME_PART));

    const [postResponses, postErrors] = await axiodWrapper(
        (res) => res, 
        {
            url: (channel) => `${DISCORD_API_URL}/channels/${channel.id}/messages`,
            urlGeneratorData: channelsToSendMsgTo,
            method: 'post',
            headers: { 'Content-Type': 'application/json'},
            data: { content: `@here\n${msg}`}
        }
    );

    if(postErrors) {
        showError('There was a problem with sending messages!', postErrors);
        return;
    }

    console.log(`Message sent to ${postResponses.length} channel(s)!`);
};


const checkCompetitions = async (events: Events) => {    
    console.log(yellow(`Looking for competitions in ${COUNTRY_NAME}...`));

    const [site, siteError] = await axiodWrapper(
        (res) =>new DOMParser().parseFromString(res.data, "text/html"), 
        {
            url: WCA_URL,
            injectHeader: false
        }
    );

    if(siteError) {
        showError('There was a problem with getting WCA site!');
    }
    
    const messages: string[] = [];

    [...(site?.querySelector('#upcoming-comps > ul')?.children || [])].forEach((child) => {
        const name = child?.children[1]?.children[0].children[1].textContent;
        const location = child?.children[1]?.children[1]?.textContent;

        if(location?.includes(COUNTRY_NAME)) {
            const event = `${location?.split(', ')[1].trim()}: ${name.trim()}`;
            if(!events[event]) {
                messages.push(event);

                console.log(`${brightCyan(location?.split(', ')[1].trim())}: ${green(name.trim())}`);

                events[event] = true;
                Deno.writeTextFile(EVENTS_CACHE_FILENAME, JSON.stringify(events));
            }
        }
    });

    if(messages.length) {
        const message = messages.join('\n');

        console.log(`${yellow('Sending message to discord:')}\n${blue(message)}`);
        sendMessage(message);
    }

    console.log((`${yellow('Done looking at competitions! See you in')} ${brightCyan(`${DELAY_VALUE /1000}s!`)}`));
};

const events: Events = await Deno.readTextFile(EVENTS_CACHE_FILENAME).then((text) => JSON.parse(text));

checkCompetitions(events);
setInterval(() => checkCompetitions(events), DELAY_VALUE);