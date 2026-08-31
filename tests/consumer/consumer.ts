import { createRenderer, render, type RenderEngine } from '@deckflow/deckrender';

declare const engine: RenderEngine;
void engine;

void render({ input: 'deck.pptx', engine: 'local', format: 'image' });
void render({ input: 'deck.pptx', engine, format: 'image' });
void createRenderer({ engine }).render({ input: 'deck.pptx' });
