import { describeDifferential } from './hydrate/differential'

describeDifferential('memory', () => ({ engine: 'memory', defaultTTL: '10 minutes' }))
