import { appendFileSync, existsSync, readFileSync } from 'node:fs';

/** One line of the campaign's events.jsonl. `at` is ms since the epoch. */
export interface Event {
    at: number;
    type: string;
    [key: string]: unknown;
}

const replacer = (_: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value;

/** Appends events to a JSONL file and echoes each one to stdout. */
export class EventLog {
    constructor(private readonly path: string) {}

    write(type: string, fields: Record<string, unknown> = {}) {
        const event: Event = { at: Date.now(), type, ...fields };
        appendFileSync(this.path, JSON.stringify(event, replacer) + '\n');
        const { at, type: _t, ...rest } = event;
        console.log(
            `${new Date(at).toISOString()} ${type} ${JSON.stringify(rest, replacer)}`
        );
    }

    static read(path: string): Event[] {
        if (!existsSync(path)) return [];
        return readFileSync(path, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Event);
    }
}
