import { SETTINGS_EVENT } from "./settings.mjs";

// Presentation state is independent of model rendering and shared settings.
function initDesk() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const rank = document.querySelector('.rank-control');
  const options = document.querySelector('.projection-options');
  function activate(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
    rank.hidden = tab.id !== 'tab-training';
    options.hidden = tab.id === 'tab-training';
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      activate(tabs[next]);
      tabs[next].focus();
    });
  });
  activate(tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0]);
  const metric = document.querySelector('#rank-metric');
  const updateMetric = () => {
    document.querySelector('#view-training').dataset.metric = metric.value;
  };
  metric.addEventListener('change', updateMetric);
  // Settings restoration also updates the selected metric.
  document.addEventListener(SETTINGS_EVENT, updateMetric);
  updateMetric();
}

if (typeof document !== 'undefined') initDesk();
