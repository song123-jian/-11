import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { installFrontendDiagnostics } from './services/diagnostics'
import { startReminderScheduler } from './services/reminderScheduler'

const app = createApp(App)
installFrontendDiagnostics(app)
startReminderScheduler()
app.mount('#app')
