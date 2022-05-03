import pkg from '@relaypro/sdk'
const { relay, Event, createWorkflow, Uri } = pkg
import axios from 'axios'
import express from 'express'

const auth_endpoint = `https://auth.relaygo.com/oauth2/token`
const express1 = express()
const port = process.env.PORT || 3000

express1.use(express.json());
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

express1.post('/', async (req, res) => {
  console.log(`Request to /notify`)
  let target = req.body.target
  let text = req.body.text
  let confirm = req.body.confirmation_required
  try { 
    const response = await _axios.post(`${process.env.RELAY_HOST}${process.env.RELAY_WF}?subscriber_id=${process.env.SUB_ID}&user_id=VIRT2dXWtVfJ5PKZaBsogij8dS`,
    {
      "action": "invoke",
      "action_args": {
        "targets": target,
        "text": text,
        "confirmation_required": confirm
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

const alert = createWorkflow(wf => {
  wf.on(Event.START, async (event) => {
    console.log(`Event: ${JSON.stringify(event.trigger.args.args)}`)
    wf.set({"target":event.trigger.args.args.targets, 
            "text": event.trigger.args.args.text, 
            "confirm": event.trigger.args.args.confirmation_required})
    
    const { trigger: { args: { source_uri } } } = event
    wf.startInteraction([source_uri], `relay alerts`)
  })

  wf.on(Event.INTERACTION_STARTED, async ({ source_uri }) => {
    const deviceName = Uri.parseDeviceName(source_uri)
    console.log(`interaction start ${source_uri}`)
    const targets = await wf.getVar(`target`, undefined)
    const text = await wf.getVar(`text`, undefined)
    
    const confirm = await wf.getVar(`confirm`, undefined)

    const actualTargets = targets.split(`,`).map(Uri.groupName)
    console.log(`broadcast workflow targets`, actualTargets)
    if (confirm === `yes`) {
      await wf.alert(actualTargets, source_uri, 'notify', text)
    } else {
      await wf.broadcast(actualTargets, source_uri, 'notify', text)
    }
  })

  wf.on(Event.NOTIFICATION, async (event) => { 
    if(event.event === `ack_event`) {
      await wf.broadcast(event.source_uri, event.source_uri, `confirmation`, `Confirmed`)
    }
    const targets = await wf.getVar(`target`, undefined)
    const actualTargets = targets.split(`,`).map(Uri.groupName)
    await wf.cancelAlert(actualTargets, event.name)
    await wf.terminate()
  })
})


const server = express1.listen(port, () => {
  console.log(`express listening on ${port}`)
})
const app = relay({server})

app.workflow(`alert`, alert)
