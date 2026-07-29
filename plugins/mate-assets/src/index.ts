import mate from '@hcengineering/mate'
import { loadMetadata } from '@hcengineering/platform'

const icons = require('../assets/icons.svg') as string // eslint-disable-line

loadMetadata(mate.icon, {
  Mate: `${icons}#mate`,
  Runtime: `${icons}#runtime`
})
