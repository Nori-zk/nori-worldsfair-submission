import clashDisplay from './ClashDisplay-Variable.woff2';
import noriLogo from './Nori.svg';
import noriFavicon from './favicon.png';
import backgroundLight from './BackgroundLight.svg';
import bottomShadows from './BottomShadows.svg';
import ethereumLogo from './Ethereum.svg';
import solanaLogo from './SolanaLogoMark.svg';
import swapIcon from './Swap.svg';
import tokenIcon from './Token.svg';

export {
    noriLogo,
    noriFavicon,
    backgroundLight,
    bottomShadows,
    ethereumLogo,
    solanaLogo,
    swapIcon,
    tokenIcon,
};

/**
 * Nori's font and colour tokens and the page defaults built on them: the
 * page-wide stylesheet each app passes to `bootstrap`'s `globals.styles`.
 */
export const brandStyles = `
@font-face {
    font-family: 'Clash Display';
    font-style: normal;
    font-weight: 200 700;
    font-display: swap;
    src: url('${clashDisplay}') format('woff2');
}
:root {
    --nori-very-dark-green: #060a08;
    --nori-dark-green: #062817;
    --nori-connected-green: #1f3029;
    --nori-light-green: #64e18e;
    --nori-glow-green: #1f6344;
    --nori-logo-green: #03ff9f;
    --nori-neon-green: #48ede7;
    --nori-neon-blue: #84f7fc;
    --nori-neon-yellow: #f9e46b;
    --nori-neon-red: #fb635e;
    --nori-text: #e8f1ec;
    --nori-muted: #9fb3a8;
    --nori-font: 'Clash Display', system-ui, sans-serif;
}
html,
body {
    margin: 0;
    background: var(--nori-very-dark-green);
    color: var(--nori-text);
    font-family: var(--nori-font);
}
`;
