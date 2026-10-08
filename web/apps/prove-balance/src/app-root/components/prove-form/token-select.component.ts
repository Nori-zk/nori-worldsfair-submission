import { Component, Inject, RxElement, state } from '@yaw-rx/core';
import { RxIf } from '@yaw-rx/core/directives/rx-if';
import { RxFor } from '@yaw-rx/core/directives/rx-for';
import { combineLatest, map, type Observable } from 'rxjs';
import {
    ethereumLogo,
    type ListedToken,
    TokenListService,
    tokenIcon,
} from '@nori-zk/solana-web-ui';
import { TOKEN_CHOSEN } from './token-option.component.js';
import './token-option.component.js';
import styles from './token-select.component.css';

/** ETH, first in the list. */
const ETH: ListedToken = {
    address: 'eth',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    logoURI: ethereumLogo,
};

/** The last row, for a token the list does not have. */
const OTHER: ListedToken = {
    address: 'other',
    symbol: 'Other token…',
    name: 'paste its address',
    decimals: 18,
    logoURI: tokenIcon,
};

/**
 * The token dropdown: the chosen token with its icon, opening onto ETH, the
 * token list's tokens on the connected chain, and "Other token…".
 */
@Component({
    selector: 'token-select',
    directives: [RxIf, RxFor],
    template: `
        <button type="button" class="current" [disabled]="disabled" onclick="toggle">
            <img [src]="current.logoURI" alt="" />
            <span>{{ current.symbol }}</span>
        </button>
        <div rx-if="open">
            <div class="options" rx-for="options by address">
                <token-option></token-option>
            </div>
        </div>
    `,
    styles,
})
export class TokenSelect extends RxElement {
    @Inject(TokenListService) private readonly tokenList!: TokenListService;
    /** The chosen asset: `eth`, a token address, or anything else for "Other token…". */
    @state asset = 'eth';
    @state open = false;
    /** Whether the choice is fixed, while the transaction is confirmed or the proof is under way. */
    @state disabled = false;

    private readonly close = (): void => {
        this.open = false;
    };

    /** Closes on a press outside the dropdown. */
    private readonly onPointerDown = (event: PointerEvent): void => {
        if (!this.contains(event.target as Node)) this.close();
    };

    /** Closes on Escape. */
    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') this.close();
    };

    /** Closes when keyboard focus leaves the dropdown. */
    private readonly onFocusOut = (event: FocusEvent): void => {
        if (!this.contains(event.relatedTarget as Node | null)) this.close();
    };

    override onInit(): void {
        this.addEventListener(TOKEN_CHOSEN, this.close);
        this.addEventListener('mouseleave', this.close);
        this.addEventListener('focusout', this.onFocusOut);
        document.addEventListener('pointerdown', this.onPointerDown);
        document.addEventListener('keydown', this.onKeyDown);
    }

    get options$(): Observable<ListedToken[]> {
        return this.tokenList.tokens$.pipe(map((tokens) => [ETH, ...tokens, OTHER]));
    }

    get current$(): Observable<ListedToken> {
        return combineLatest([this.asset$, this.tokenList.tokens$]).pipe(
            map(([asset, tokens]) =>
                asset === 'eth'
                    ? ETH
                    : (tokens.find(
                          (token) => token.address.toLowerCase() === asset.toLowerCase(),
                      ) ?? OTHER),
            ),
        );
    }

    toggle(): void {
        this.open = !this.disabled && !this.open;
    }

    override onDestroy(): void {
        this.removeEventListener(TOKEN_CHOSEN, this.close);
        this.removeEventListener('mouseleave', this.close);
        this.removeEventListener('focusout', this.onFocusOut);
        document.removeEventListener('pointerdown', this.onPointerDown);
        document.removeEventListener('keydown', this.onKeyDown);
    }
}
