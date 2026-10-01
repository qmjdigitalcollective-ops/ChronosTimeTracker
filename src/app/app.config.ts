import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  // This app has no zone.js and is built entirely on signals, but without this
  // provider nothing actually schedules a re-render once a signal changes
  // *after* a click handler's first `await` — the screen only updated on the
  // synchronous part of an action (and incidentally, whenever something else
  // happened to trigger a check), which is why clocking in sometimes saved
  // correctly but the button never visibly switched to "Clocked In."
  providers: [provideBrowserGlobalErrorListeners(), provideZonelessChangeDetection(), provideRouter(routes)],
};
