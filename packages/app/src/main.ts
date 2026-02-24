import { mount } from 'svelte'
import '@knadh/oat/oat.min.css'
import './styles/global.css'
import '@xterm/xterm/css/xterm.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
