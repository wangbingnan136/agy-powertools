(() => {
  globalThis.__agyCreatePrismIntegration = function createPrismIntegration(env) {
    let optics, workbench, optionKey, lastExecution = null, lastExecutionKey, attemptedHomeLoad = false;
    let wallpaper = null;
    const opticsOptions = opts => ({ ...opts, contextStyle: 'ring', wallpaperEnabled: Boolean(opts.wallpaperEnabled && wallpaper) });
    function selectWallpaper(file) {
      if (file !== null && (!(file instanceof File) || !file.size || !/^(image\/(avif|gif|jpeg|png|webp)|video\/(mp4|webm))$/i.test(file.type))) {
        throw new Error(env.uiText('请选择支持的图片或视频', 'Choose a supported image or video'));
      }
      const previous = wallpaper;
      wallpaper = file ? { hasMedia: true, fileName: file.name, kind: file.type.startsWith('video/') ? 'video' : 'image', mediaUrl: URL.createObjectURL(file) } : null;
      optics?.setWallpaperStatus(wallpaper);
      if (previous) URL.revokeObjectURL(previous.mediaUrl);
      syncSettings();
      return wallpaper?.fileName || '';
    }
    const workbenchOptions = opts => ({ ...opts, thoughtTranslate: 'off', translateSessionTitles: false, omniViewer: false });
    function syncSettings(refresh = false) {
      const opts = env.options();
      const key = JSON.stringify([opts, wallpaper?.mediaUrl]);
      if (optionKey !== key) {
        optionKey = key;
        const opt = opticsOptions(opts), bench = workbenchOptions(opts);
        optics ??= globalThis.__agyCreateOptics?.({ ...env, request: undefined, options: () => opticsOptions(env.options()) });
        workbench ??= globalThis.__agyCreateWorkbench?.({ ...env, options: () => workbenchOptions(env.options()) });
        optics?.sync(opt, lastExecution);
        workbench?.sync(bench);
      } else if (refresh) {
        workbench?.sync(workbenchOptions(opts));
      }
      const home = opts.enabled && opts.homeStudio && location.pathname === '/';
      if (!home) attemptedHomeLoad = false;
      else if (!attemptedHomeLoad && !env.dashboard()) {
        attemptedHomeLoad = true;
        void env.loadDashboard().catch(() => {});
      }
    }

    function syncExecution(execution) {
      lastExecution = execution;
      const key = JSON.stringify([execution?.conversationId, execution?.status, execution?.live?.waiting, Boolean(execution?.live?.errorText || execution?.live?.genError), execution?.live?.lastCase]);
      if (key === lastExecutionKey) return;
      lastExecutionKey = key;
      optics?.sync(opticsOptions(env.options()), execution);
    }

    function vialProps(data, source) {
      const cw = data?.contextWindow || {}, stats = data?.telemetry || {};
      const compact = () => {
        const composer = source?.closest?.('.surface-composer-card');
        if (!composer || !env.adapter.getComposerText || !env.adapter.setComposerText) return;
        if (env.adapter.getComposerText(composer)?.trim()) {
          env.notify({ title: env.uiText('请先处理输入框草稿', 'Keep or clear your current draft first'), tag: 'agy-vial-draft' });
          return;
        }
        env.adapter.setComposerText(composer, '/compact');
      };
      const sum = (keys) => (cw.categories || []).filter(row => keys.includes(row.key)).reduce((n, row) => n + (Number(row.tokens) || 0), 0);
      return {
        usedTokens: cw.usedTokens, maxTokens: cw.maxTokens, percent: cw.usedPercent,
        streaming: lastExecution?.conversationId === data?.conversationId && [2, 4].includes(lastExecution?.status),
        systemTokens: sum(['system', 'rules']), messageTokens: sum(['messages', 'conversation', 'user', 'assistant']), toolTokens: sum(['tools', 'tool']),
        tps: stats.latestTps ?? stats.tps, ttftMs: stats.avgTtftMs, onCompact: compact
      };
    }

    return {
      syncSettings, syncExecution, vialProps, selectWallpaper, wallpaperName: () => wallpaper?.fileName || '',
      openPickedMedia: file => workbench?.openPickedMedia(file),
      mountVial: (element, props) => optics?.mountPopoverVial(element, props),
      dispose() { workbench?.dispose(); optics?.dispose(); if (wallpaper) URL.revokeObjectURL(wallpaper.mediaUrl); wallpaper = null; }
    };
  };
})();
