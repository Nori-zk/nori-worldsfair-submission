import {
    type GuardRead,
    ago,
    amount,
    blockText,
    blockUrl,
    solanaAccountUrl,
    STATUS_COLOUR,
} from '@nori-zk/solana-web-ui';
import { mintName, shortAddress } from './guards.js';
import {
    coverageText,
    lenderSentence,
    statusSentence,
    statusWord,
    type GuardStatus,
} from './status-text.js';

/** One guard's card, every string already written: `rx-for` copies these onto the card. */
export interface GuardCardView {
    /** The guard's address. */
    key: string;
    /** The guard and its mint's supply. */
    read: GuardRead;
    status: GuardStatus;
    statusWord: string;
    /** `color: <the status colour>`. */
    statusStyle: string;
    sentence: string;
    sentenceLink: string;
    sentenceLinkUrl: string;
    sentenceEnd: string;
    noSentenceLink: boolean;
    /** `Demo mint Fhw5…cbhi`. */
    mintLabel: string;
    mintUrl: string;
    backing: string;
    /** `proven 26 min ago`, or `none proven yet`. */
    backingDetail: string;
    backingBlock: string;
    backingBlockUrl: string;
    unproven: boolean;
    supply: string;
    /** `covers 100.02% of supply`, or `short by …`. */
    coverage: string;
    /** What a lender's deposit would get now. */
    lender: string;
}

/**
 * A guard as its card shows it.
 *
 * @param read The guard and its mint's live supply.
 * @param nowSecs Now, unix seconds.
 * @returns The card's text and links.
 */
export function cardOf(read: GuardRead, nowSecs: number): GuardCardView {
    const { address, guard, supply, decimals, status } = read;
    const unproven = guard.backingEthTime === 0n;
    const since = ago(nowSecs - Number(guard.backingEthTime));
    const sentence = statusSentence({
        status,
        above: supply > guard.backing ? amount(supply - guard.backing, decimals) : '0',
        tolerance: amount(guard.config.tolerance, decimals),
        staleFor: unproven ? '' : since.replace(/ ago$/, ''),
        tripDeficit: amount(guard.tripDeficit, decimals),
        tripBlock: guard.tripEthBlock === 0n ? '' : blockText(guard.tripEthBlock),
    });
    return {
        key: address,
        read,
        status,
        statusWord: statusWord(status),
        statusStyle: `color: ${STATUS_COLOUR[status]}`,
        sentence: sentence.text,
        sentenceLink: sentence.link,
        sentenceLinkUrl: blockUrl(guard.tripEthBlock),
        sentenceEnd: sentence.end,
        noSentenceLink: sentence.link === '',
        mintLabel: `${mintName(guard.mint)} ${shortAddress(guard.mint)}`,
        mintUrl: solanaAccountUrl(guard.mint),
        backing: unproven ? '—' : amount(guard.backing, decimals),
        backingDetail: unproven ? 'none proven yet' : `proven ${since}`,
        backingBlock: blockText(guard.backingEthBlock),
        backingBlockUrl: blockUrl(guard.backingEthBlock),
        unproven,
        supply: amount(supply, decimals),
        coverage: unproven
            ? ''
            : coverageText(guard.backing, supply, amount(supply - guard.backing, decimals)),
        lender: lenderSentence(status),
    };
}
