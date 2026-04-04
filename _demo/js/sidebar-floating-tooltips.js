(function initSidebarFloatingTooltips() {
  'use strict';

  const HIDE_MS = 160;
  const GAP = 8;
  const MAX_W = 560;
  const VIEW_MARGIN = 10;

  function bindPair(anchor, tip) {
    if (!anchor || !tip) return;

    document.body.appendChild(tip);
    tip.classList.add('sidebar-floating-tooltip');

    let hideTimer = null;

    function clearHide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function scheduleHide() {
      clearHide();
      hideTimer = setTimeout(() => {
        tip.classList.remove('is-visible');
        tip.style.visibility = '';
        tip.style.left = '';
        tip.style.top = '';
        hideTimer = null;
      }, HIDE_MS);
    }

    function position() {
      const ar = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(MAX_W, vw - VIEW_MARGIN * 2);
      tip.style.width = `${w}px`;
      tip.style.position = 'fixed';
      tip.style.left = '-9999px';
      tip.style.top = '0';
      tip.style.visibility = 'hidden';
      tip.classList.add('is-visible');
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = ar.right + GAP;
      let top = ar.top;
      if (left + tw > vw - VIEW_MARGIN) {
        left = ar.left - tw - GAP;
      }
      if (left < VIEW_MARGIN) left = VIEW_MARGIN;
      if (left + tw > vw - VIEW_MARGIN) {
        left = Math.max(VIEW_MARGIN, vw - VIEW_MARGIN - tw);
      }
      if (top + th > vh - VIEW_MARGIN) {
        top = Math.max(VIEW_MARGIN, vh - VIEW_MARGIN - th);
      }
      if (top < VIEW_MARGIN) top = VIEW_MARGIN;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
      tip.style.visibility = 'visible';
    }

    function show() {
      clearHide();
      position();
    }

    anchor.addEventListener('mouseenter', show);
    anchor.addEventListener('mouseleave', scheduleHide);
    tip.addEventListener('mouseenter', clearHide);
    tip.addEventListener('mouseleave', scheduleHide);
    anchor.addEventListener('focusin', show);
    anchor.addEventListener('focusout', (e) => {
      if (!tip.contains(e.relatedTarget)) scheduleHide();
    });
    window.addEventListener(
      'scroll',
      () => {
        if (tip.classList.contains('is-visible')) position();
      },
      true,
    );
    window.addEventListener('resize', () => {
      if (tip.classList.contains('is-visible')) position();
    });
  }

  function run() {
    bindPair(
      document.querySelector('.memory-estimate-popover-anchor'),
      document.getElementById('memory-estimate-tooltip'),
    );
    bindPair(
      document.querySelector('.tools-demo-video-popover-anchor'),
      document.getElementById('demo-video-tooltip'),
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
