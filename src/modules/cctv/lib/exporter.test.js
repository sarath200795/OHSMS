import { describe, it, expect } from 'vitest'
import {
  cameraDefectRows, dvrDefectRows, merakiDefectRows,
  cameraHealthRows, dvrHealthRows, merakiHealthRows, siteHealthRows,
} from './exporter'
import { estateHealth } from './health'

const meraki = (o = {}) => ({ id: 'm1', name: 'MX-Hosur', ipAddress: '10.0.0.1', siteId: 's1', siteName: 'Hosur', status: 'online', ...o })
const dvr = (o = {}) => ({ id: 'd1', name: 'DVR-1', ipAddress: '10.0.0.10', siteId: 's1', siteName: 'Hosur', status: 'online', channels: 16, ...o })
const cam = (o = {}) => ({ id: 'c1', name: 'CAM-1', location: 'Main gate', dvrId: 'd1', siteId: 's1', siteName: 'Hosur', status: 'online', defects: [], ...o })

describe('defect extracts stay separate', () => {
  // The promise this module is built on.
  it('a Meraki outage produces ONE Meraki row and no camera rows', () => {
    const e = estateHealth({
      cameras: [cam(), cam({ id: 'c2', name: 'CAM-2' }), cam({ id: 'c3', name: 'CAM-3' })],
      dvrs: [dvr()],
      merakis: [meraki({ status: 'offline' })],
    })
    expect(cameraDefectRows(e.defects.camera)).toEqual([])
    expect(dvrDefectRows(e.defects.dvr)).toEqual([])
    const rows = merakiDefectRows(e.defects.meraki)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ 'Meraki Device': 'MX-Hosur', Status: 'Offline', Defects: 'Offline' })
  })

  it('a failed DVR produces one DVR row and no camera rows', () => {
    const e = estateHealth({
      cameras: [cam(), cam({ id: 'c2' })],
      dvrs: [dvr({ status: 'offline' })],
      merakis: [meraki()],
    })
    expect(cameraDefectRows(e.defects.camera)).toEqual([])
    expect(dvrDefectRows(e.defects.dvr)[0]).toMatchObject({ DVR: 'DVR-1', Status: 'Offline', 'No. of Defects': 1 })
  })

  it('a genuinely broken camera does appear, with its fault named', () => {
    const e = estateHealth({ cameras: [cam({ status: 'offline' })], dvrs: [dvr()], merakis: [meraki()] })
    expect(cameraDefectRows(e.defects.camera)[0]).toMatchObject({
      Camera: 'CAM-1', Location: 'Main gate', Site: 'Hosur', DVR: 'DVR-1',
      Status: 'Offline', Defects: 'Offline', Fault: 'Device fault',
    })
  })

  it('renders defect keys as the labels people recognise', () => {
    const e = estateHealth({ cameras: [cam({ defects: ['blur', 'angle'] })], dvrs: [dvr()], merakis: [meraki()] })
    expect(cameraDefectRows(e.defects.camera)[0]).toMatchObject({
      Defects: 'Blur, Angle not proper', 'No. of Defects': 2, Status: 'Online',
    })
  })
})

describe('health rows', () => {
  it('names what a camera is down because of, and which device to blame', () => {
    const e = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki({ status: 'offline' })] })
    expect(cameraHealthRows(e.cameras)[0]).toMatchObject({
      Camera: 'CAM-1',
      'Reported Status': 'Online',   // the camera never said anything was wrong
      'Effective Status': 'Offline', // …but it is dark
      'Down Because': 'Meraki down',
      'Blamed Device': 'MX-Hosur',
      Healthy: 'No',
    })
  })

  it('leaves the blame columns empty for a healthy camera', () => {
    const e = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki()] })
    expect(cameraHealthRows(e.cameras)[0]).toMatchObject({ 'Down Because': '—', 'Blamed Device': '—', Healthy: 'Yes' })
  })

  it('carries camera counts and uptime on each DVR row', () => {
    const e = estateHealth({
      cameras: [cam(), cam({ id: 'c2', status: 'offline' })],
      dvrs: [dvr()], merakis: [meraki()],
    })
    expect(dvrHealthRows(e.dvrReport)[0]).toMatchObject({
      DVR: 'DVR-1', 'IP Address': '10.0.0.10', Channels: 16,
      'No. of Cameras': 2, 'Cameras Online': 1, 'Cameras Offline': 1, 'Camera Uptime %': 50,
    })
  })

  it('spells out what a downed Meraki means', () => {
    const e = estateHealth({ cameras: [], dvrs: [], merakis: [meraki({ status: 'offline' })] })
    expect(merakiHealthRows(e.merakis)[0].Impact).toMatch(/all dvrs and cameras/i)
  })

  it('rolls sites up with the counts the request asked for', () => {
    const e = estateHealth({ cameras: [cam()], dvrs: [dvr()], merakis: [meraki()] })
    expect(siteHealthRows(e.siteReport)[0]).toMatchObject({
      Site: 'Hosur', 'No. of Cameras': 1, 'Cameras Online': 1,
      'No. of DVR': 1, 'No. of Meraki': 1, 'Camera Uptime %': 100,
    })
  })

  it('does not emit undefined into any cell', () => {
    const e = estateHealth({ cameras: [{ id: 'x', name: 'bare' }], dvrs: [], merakis: [] })
    const row = cameraHealthRows(e.cameras)[0]
    expect(Object.values(row).every((v) => v !== undefined && v !== null)).toBe(true)
  })
})
