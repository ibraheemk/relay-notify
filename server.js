import pkg from '@relaypro/sdk'
const { relay, Event, createWorkflow, Uri } = pkg
import axios from 'axios'
import express from 'express'
import basicAuth from 'express-basic-auth'

const auth_endpoint = `https://auth.relaygo.com/oauth2/token`
const express1 = express()
const port = process.env.PORT || 3000

express1.use(express.json());
express1.use(basicAuth({
  users: {'admin':'secret'}
}))
express1.use(express.urlencoded({
  extended: true
}));

const _axios = axios.create()

var location = ''

const access_token = await refresh_auth()
_axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`

_axios.interceptors.response.use(function (response) {
  return response;
}, async function (error) {
  console.log('ERROR')
  if(error.response) {
    console.log(error.response.data)
    console.log(error.response.status)
  }
  console.log(error.config)
  let originalRequest = error.config
  if (error.response.status === 401 && !originalRequest._retry) {
    originalRequest._retry = true
    const token = await refresh_auth()
    _axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    return _axios(originalRequest)
  }
  return Promise.reject(error)
})

express1.post('/notify/:location', async (req, res) => {
  console.log(`Request to /notify`)
  location = req.params.location
  try { 
    const response = await _axios.post(`${process.env.RELAY_HOST}${process.env.RELAY_WF}?subscriber_id=${process.env.SUB_ID}&user_id=VIRT2dXWtVfJ5PKZaBsogij8dS`,
    {
      "action": "invoke",
      "action_args": {
        "targets": 'Jim',
        "text": 'Maintenance needed',
        "confirmation_required": 'yes'
        }
    })
    if (response.status == 200) {
      console.log(`Remote trigger invoked`)
    }
  } catch (err) {
    console.error(err)
  }
  res.send('Recieved')
})

async function refresh_auth() {
  try {
    const response = await axios.post(auth_endpoint, new URLSearchParams({
      'grant_type': 'refresh_token',
      'client_id': process.env.CLIENT_TOKEN,
      'refresh_token': process.env.REFRESH_TOKEN
    }),
    { 
      headers : {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    return response.data.access_token
  } catch (err) {
    console.error(err)
  }
}


export default createWorkflow(relay => {
  relay.on(Event.START, async (event) => {
    const { trigger: { args: { source_uri } } } = event
    relay.startInteraction([source_uri], `hello world`)
  })

  relay.on(Event.INTERACTION_STARTED, async ({ source_uri }) => {
    const deviceName = Uri.parseDeviceName(source_uri)
    await relay.sayAndWait(source_uri, `What is your name ?`)
    const { text: userProvidedName } = await relay.listen(source_uri)
    await relay.sayAndWait(source_uri, `Hello ${userProvidedName}! You are currently using ${deviceName}`)
    await relay.terminate()
  })
})

const alert = createWorkflow(wf => {
  wf.on(Event.START, async (event) => {
    const { trigger: { args: { source_uri } } } = event
    wf.startInteraction([source_uri], `relay alerts`)
  })

  wf.on(Event.INTERACTION_STARTED, async ({ source_uri }) => {
    const deviceName = Uri.parseDeviceName(source_uri)
    console.log(`interaction start ${source_uri}`)
    //const [targets, text, confirm] = await wf.get([`targets`, `text`, `confirmation_required`])
    //console.log(`Targets: ${targets}, Text: ${text}, Confirm: ${confirm}`)
    const targets = 'Jim'
    const text = `Maintenance needed at ${location}`
    const confirm = true

    const actualTargets = targets.split(`,`).map(Uri.deviceName)
    console.log(`broadcast workflow targets`, actualTargets)
    if (confirm) {
      await wf.alert(actualTargets, source_uri, 'notify', text)
    } else {
      await wf.broadcast(actualTargets, text)
    }
    await wf.terminate()

  })
})

const server = express1.listen(port, () => {
  console.log(`express listening on ${port}`)
})
const app = relay({server})

app.workflow(`alert`, alert)
