;(() => {
  if (typeof window === 'undefined') {
    self.addEventListener('error', event => self.postMessage({
      cmd: 'callHandler', handler: 'reportRuntimeError', args: [String(event.error?.stack || event.message)]
    }));
    return;
  }
  const started = performance.now();
  addRunDependency('load_game_data');
  dataLoader.loadMapWithDeps(Module.startMap || 'd1_town_01').then(() => {
    Module.assetLoadMs = performance.now() - started;
    console.info(`Ravenholm assets ready in ${(Module.assetLoadMs / 1000).toFixed(2)} seconds`);
    removeRunDependency('load_game_data');
    dataLoader.scheduleNext(Module.startMap || 'd1_town_01');
  }).catch(error => {
    dataLoader.progress(`Cannot start: ${error.message}`); console.error(error);
  });
})();
