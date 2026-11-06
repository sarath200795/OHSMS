// The import call sites use. On the WEEHS build this is the Firebase SDK, so a
// test that mocks firebase/firestore still sees its mock. On an own-stack build
// (VITE_DATA_DRIVER=postgres) the same calls go through the postgres adapter.
// firebase.js and the Firestore adapter keep importing the SDK directly: they
// are the Firebase bootstrap, not module code.

import * as firebaseFirestore from 'firebase/firestore'
import { dataDriver } from './index'
import * as postgresClient from './postgresClient'

function driverIsPostgres() {
  return dataDriver === 'postgres'
}

function forward(name) {
  return (...args) => {
    if (driverIsPostgres()) return postgresClient[name](...args)
    const fn = firebaseFirestore[name]
    if (typeof fn !== 'function') {
      throw new Error(`firebase/firestore is missing ${name}`)
    }
    return fn(...args)
  }
}

export const addDoc = forward('addDoc')
export const arrayRemove = forward('arrayRemove')
export const arrayUnion = forward('arrayUnion')
export const collection = forward('collection')
export const deleteDoc = forward('deleteDoc')
export const deleteField = forward('deleteField')
export const doc = forward('doc')
export const getCountFromServer = forward('getCountFromServer')
export const getDoc = forward('getDoc')
export const getDocs = forward('getDocs')
export const increment = forward('increment')
export const limit = forward('limit')
export const onSnapshot = forward('onSnapshot')
export const orderBy = forward('orderBy')
export const query = forward('query')
export const runTransaction = forward('runTransaction')
export const serverTimestamp = forward('serverTimestamp')
export const setDoc = forward('setDoc')
export const updateDoc = forward('updateDoc')
export const where = forward('where')
export const writeBatch = forward('writeBatch')

export const Timestamp = new Proxy(
  {},
  {
    get(_target, prop) {
      const source = driverIsPostgres() ? postgresClient.Timestamp : firebaseFirestore.Timestamp
      const value = source?.[prop]
      return typeof value === 'function' ? value.bind(source) : value
    },
    construct(_target, args) {
      const Source = driverIsPostgres() ? postgresClient.Timestamp : firebaseFirestore.Timestamp
      return new Source(...args)
    },
  }
)
