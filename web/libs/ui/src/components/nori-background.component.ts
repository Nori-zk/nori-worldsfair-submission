import { Component, RxElement } from '@yaw-rx/core';
import { animate, type AnimationPlaybackControls } from 'motion';
import { fromEvent, map, startWith, type Subscription } from 'rxjs';
import { backgroundLight, bottomShadows } from '../brand/brand.js';
import styles from './nori-background.component.css';

/**
 * Nori's page background, as in the bridge zkapp: the dark green radial
 * gradient, the light shafts over it and the shadows along the bottom. The
 * light breathes slowly, and holds still under `prefers-reduced-motion`.
 */
@Component({
    selector: 'nori-background',
    template: `
        <img class="light" src="${backgroundLight}" alt="" #light />
        <img class="shadows" src="${bottomShadows}" alt="" />
    `,
    styles,
})
export class NoriBackground extends RxElement {
    light!: HTMLImageElement;
    private breathing: AnimationPlaybackControls | undefined;
    private reducedMotion: Subscription | undefined;

    override onRender(): void {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotion = fromEvent<MediaQueryListEvent>(query, 'change')
            .pipe(
                map((event) => event.matches),
                startWith(query.matches),
            )
            .subscribe((reduced) => {
                this.breathing?.stop();
                this.breathing = reduced
                    ? undefined
                    : animate(
                          this.light,
                          { opacity: [0.75, 1, 0.85] },
                          {
                              duration: 14,
                              repeat: Infinity,
                              repeatType: 'mirror',
                              ease: 'easeInOut',
                          },
                      );
            });
    }

    override onDestroy(): void {
        this.reducedMotion?.unsubscribe();
        this.breathing?.stop();
    }
}
