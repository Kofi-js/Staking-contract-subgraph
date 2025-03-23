import {
  EmergencyWithdrawn as EmergencyWithdrawnEvent,
  OwnershipTransferred as OwnershipTransferredEvent,
  Paused as PausedEvent,
  RewardRateUpdated as RewardRateUpdatedEvent,
  RewardsClaimed as RewardsClaimedEvent,
  Staked as StakedEvent,
  StakingInitialized as StakingInitializedEvent,
  StakingPaused as StakingPausedEvent,
  StakingUnpaused as StakingUnpausedEvent,
  TokenRecovered as TokenRecoveredEvent,
  Unpaused as UnpausedEvent,
  Withdrawn as WithdrawnEvent
} from "../generated/StakingContract/StakingContract"

import {
  EmergencyWithdrawn,
  RewardRateUpdated,
  RewardsClaimed,
  Staked,
  StakingInitialized,
  Withdrawn,
  User,
  StakePosition,
  ProtocolMetrics
} from "../generated/schema"

import { BigInt, Bytes } from "@graphprotocol/graph-ts"

const PROTOCOL_METRICS_ID = "protocol-metrics"

function getOrCreateUser(address: Bytes): User {
  let user = User.load(address)
  if (!user) {
    user = new User(address)
    user.totalStaked = BigInt.fromI32(0)
    user.totalWithdrawn = BigInt.fromI32(0)
    user.totalRewardsClaimed = BigInt.fromI32(0)
    user.pendingRewards = BigInt.fromI32(0)
    user.lastUpdateTimestamp = BigInt.fromI32(0)
    user.save()

    let metrics = getOrCreateProtocolMetrics()
    metrics.totalUsers = metrics.totalUsers.plus(BigInt.fromI32(1))
    metrics.save()
  }
  return user
}

function getOrCreateProtocolMetrics(): ProtocolMetrics {
  let metrics = ProtocolMetrics.load(PROTOCOL_METRICS_ID)
  if (!metrics) {
    metrics = new ProtocolMetrics(PROTOCOL_METRICS_ID)
    metrics.totalStaked = BigInt.fromI32(0)
    metrics.totalUsers = BigInt.fromI32(0)
    metrics.totalStakePositions = BigInt.fromI32(0)
    metrics.currentRewardRate = BigInt.fromI32(0)
    metrics.totalRewardsClaimed = BigInt.fromI32(0)
    metrics.totalWithdrawn = BigInt.fromI32(0)
    metrics.apr = BigInt.fromI32(0)
    metrics.lastUpdateTimestamp = BigInt.fromI32(0)
    metrics.stakingToken = Bytes.empty()
  }
  return metrics
}

function calculateApr(rewardRate: BigInt, totalStaked: BigInt): BigInt {
  if (totalStaked.equals(BigInt.fromI32(0))) {
    return BigInt.fromI32(0)
  }
  
  // APR = (rewardRate * 365 * 24 * 60 * 60 * 100) / totalStaked
  // This calculates APR as a percentage with 2 decimal places (e.g., 500 = 5.00%)
  let yearInSeconds = BigInt.fromI32(365 * 24 * 60 * 60)
  let percent = BigInt.fromI32(100)
  let annualRewards = rewardRate.times(yearInSeconds)
  return annualRewards.times(percent).div(totalStaked)
}

function createStakePosition(event: StakedEvent): StakePosition {
  let id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  let position = new StakePosition(id)
  let user = getOrCreateUser(event.params.user)
  
  position.user = user.id
  position.amount = event.params.amount
  position.timestamp = event.params.timestamp
  position.isWithdrawn = false
  position.rewardsClaimed = BigInt.fromI32(0)
  position.pendingRewards = BigInt.fromI32(0)
  
  // Assuming a 30-day unlock period - adjust according to your contract
  position.unlockTime = event.params.timestamp.plus(BigInt.fromI32(30 * 24 * 60 * 60))
  
  position.save()

  let metrics = getOrCreateProtocolMetrics()
  metrics.totalStakePositions = metrics.totalStakePositions.plus(BigInt.fromI32(1))
  metrics.save()

  return position
}

export function handleEmergencyWithdrawn(event: EmergencyWithdrawnEvent): void {
  let entity = new EmergencyWithdrawn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  let user = getOrCreateUser(event.params.user)
  entity.user = user.id
  entity.amount = event.params.amount
  entity.penalty = event.params.penalty
  entity.timestamp = event.params.timestamp
  entity.newTotalStaked = event.params.newTotalStaked
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()
}

export function handleRewardRateUpdated(event: RewardRateUpdatedEvent): void {
  let entity = new RewardRateUpdated(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.oldRate = event.params.oldRate
  entity.newRate = event.params.newRate
  entity.timestamp = event.params.timestamp
  entity.totalStaked = event.params.totalStaked

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
  
  // Update protocol metrics with the new reward rate and recalculate APR
  let metrics = getOrCreateProtocolMetrics()
  metrics.currentRewardRate = event.params.newRate
  metrics.totalStaked = event.params.totalStaked
  metrics.lastUpdateTimestamp = event.params.timestamp
  metrics.apr = calculateApr(event.params.newRate, event.params.totalStaked)
  metrics.save()
}

export function handleRewardsClaimed(event: RewardsClaimedEvent): void {
  let entity = new RewardsClaimed(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  let user = getOrCreateUser(event.params.user)
  entity.user = user.id
  entity.amount = event.params.amount
  entity.timestamp = event.params.timestamp
  entity.newPendingRewards = event.params.newPendingRewards
  entity.totalStaked = event.params.totalStaked
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Update user stats
  user.totalRewardsClaimed = user.totalRewardsClaimed.plus(event.params.amount)
  user.pendingRewards = event.params.newPendingRewards
  user.lastUpdateTimestamp = event.params.timestamp
  user.save()

  // Update protocol metrics
  let metrics = getOrCreateProtocolMetrics()
  metrics.totalRewardsClaimed = metrics.totalRewardsClaimed.plus(event.params.amount)
  metrics.totalStaked = event.params.totalStaked
  metrics.lastUpdateTimestamp = event.params.timestamp
  metrics.save()
}

export function handleStaked(event: StakedEvent): void {
  let entity = new Staked(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  let user = getOrCreateUser(event.params.user)
  entity.user = user.id
  entity.amount = event.params.amount
  entity.timestamp = event.params.timestamp
  entity.newTotalStaked = event.params.newTotalStaked
  entity.currentRewardRate = event.params.currentRewardRate
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Update user stats
  user.totalStaked = user.totalStaked.plus(event.params.amount)
  user.lastUpdateTimestamp = event.params.timestamp
  user.save()

  // Create stake position
  createStakePosition(event)

  // Update protocol metrics
  let metrics = getOrCreateProtocolMetrics()
  metrics.totalStaked = event.params.newTotalStaked
  metrics.currentRewardRate = event.params.currentRewardRate
  metrics.lastUpdateTimestamp = event.params.timestamp
  
  // Calculate and update APR
  metrics.apr = calculateApr(event.params.currentRewardRate, event.params.newTotalStaked)
  
  metrics.save()
}

export function handleStakingInitialized(event: StakingInitializedEvent): void {
  let entity = new StakingInitialized(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.stakingToken = event.params.stakingToken
  entity.initialRewardRate = event.params.initialRewardRate
  entity.timestamp = event.params.timestamp
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Initialize protocol metrics
  let metrics = getOrCreateProtocolMetrics()
  metrics.stakingToken = event.params.stakingToken
  metrics.currentRewardRate = event.params.initialRewardRate
  metrics.lastUpdateTimestamp = event.params.timestamp
  metrics.save()
}

export function handleWithdrawn(event: WithdrawnEvent): void {
  let entity = new Withdrawn(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  let user = getOrCreateUser(event.params.user)
  entity.user = user.id
  entity.amount = event.params.amount
  entity.timestamp = event.params.timestamp
  entity.newTotalStaked = event.params.newTotalStaked
  entity.currentRewardRate = event.params.currentRewardRate
  entity.rewardsAccrued = event.params.rewardsAccrued
  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash
  entity.save()

  // Update user stats
  user.totalWithdrawn = user.totalWithdrawn.plus(event.params.amount)
  user.lastUpdateTimestamp = event.params.timestamp
  user.save()

  // Update protocol metrics
  let metrics = getOrCreateProtocolMetrics()
  metrics.totalWithdrawn = metrics.totalWithdrawn.plus(event.params.amount)
  metrics.totalStaked = event.params.newTotalStaked
  metrics.currentRewardRate = event.params.currentRewardRate
  metrics.lastUpdateTimestamp = event.params.timestamp
  metrics.save()
}
