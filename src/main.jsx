/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App.jsx';
import * as api from './store.js';
import './styles.css';

// 调试/自动化测试钩子：响应式 store 数据与全部动作函数聚合在同一对象
// （修改仍走统一动作入口，保留撤销/重做栈）
window.__store = new Proxy(api, {
  get(target, prop) {
    // 数据字段（project/wizard/selected 等）直接透传 store，其余取模块导出的动作
    if (prop in target.store) return target.store[prop];
    return target[prop];
  }
});

const root = document.getElementById('root');
render(() => <App />, root);
