import {
    MAINNET_SNAPSHOT_QUERIES,
    encodeQueryData,
    queryIdOf,
    type SnapshotQuery,
} from '../queries.js';

export interface ResolvedQuery extends SnapshotQuery {
    data: string;
    queryId: string;
}

export interface QuerySelection {
    names: string[];
    target: string;
    signature: string;
    args: string;
}

/**
 * Resolves the queries a task acts on: one custom query when `target` is
 * set, else the named mainnet queries, else every mainnet query.
 */
export function resolveQueries(selection: QuerySelection): ResolvedQuery[] {
    let queries: SnapshotQuery[];

    if (selection.target) {
        if (!selection.signature)
            throw new Error('--signature is required with --target');
        queries = [
            {
                name: 'custom',
                target: selection.target,
                signature: selection.signature,
                args: selection.args ? selection.args.split(',') : [],
                description: 'Custom query',
            },
        ];
    } else if (selection.names.length) {
        queries = selection.names.map((name) => {
            const query = MAINNET_SNAPSHOT_QUERIES.find((q) => q.name === name);
            if (!query)
                throw new Error(
                    `Unknown query "${name}"; known: ${MAINNET_SNAPSHOT_QUERIES.map((q) => q.name).join(', ')}`
                );
            return query;
        });
    } else {
        queries = [...MAINNET_SNAPSHOT_QUERIES];
    }

    return queries.map((query) => {
        const data = encodeQueryData(query);
        return { ...query, data, queryId: queryIdOf(query.target, data) };
    });
}
