import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navLinks } from './nav.js';

const urls = {
    proveBalance: 'http://localhost:5180',
    guardStatus: 'http://localhost:5181',
    provenFacts: 'http://localhost:5182',
    dashboard: 'http://localhost:7400',
    tempoDashboard: '',
};

void test('the nav links each app with an address, the page its heading names marked current', () => {
    assert.deepEqual(navLinks(urls, 'Guard status'), [
        { label: 'Prove balance', url: 'http://localhost:5180', current: null },
        { label: 'Guard status', url: 'http://localhost:5181', current: 'page' },
        { label: 'Proven facts', url: 'http://localhost:5182', current: null },
        { label: 'Bridge dashboard', url: 'http://localhost:7400', current: null },
    ]);
});

void test('the Tempo dashboard is linked once it has an address', () => {
    const links = navLinks(
        { ...urls, tempoDashboard: 'https://tempo.example' },
        'Bridge dashboard',
    );
    assert.deepEqual(links.at(-1), {
        label: 'Tempo dashboard',
        url: 'https://tempo.example',
        current: null,
    });
    assert.deepEqual(
        links.filter(({ current }) => current === 'page').map(({ label }) => label),
        ['Bridge dashboard'],
    );
});
