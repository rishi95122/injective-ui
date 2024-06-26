import {
  sleep,
  HttpRestClient,
  BigNumberInBase,
  splitArrayToChunks
} from '@injectivelabs/utils'
import { CoinGeckoApi } from '@injectivelabs/token-utils'
import { Network, isDevnet, isTestnet } from '@injectivelabs/networks'

const ASSET_PRICE_SERVICE_URL =
  'https://k8s.mainnet.asset.injective.network/asset-price/v1'
const TESTNET_ASSET_PRICE_SERVICE_URL =
  'https://k8s.testnet.asset.injective.network/asset-price/v1'
const DEVNET_ASSET_PRICE_SERVICE_URL =
  'https://devnet.asset.injective.dev/asset-price/v1'

const whiteListedCoinGeckoIds: string[] = []

const getAssetMicroserviceEndpoint = (network: Network = Network.Mainnet) => {
  if (isTestnet(network)) {
    return TESTNET_ASSET_PRICE_SERVICE_URL
  }

  if (isDevnet(network)) {
    return DEVNET_ASSET_PRICE_SERVICE_URL
  }

  return ASSET_PRICE_SERVICE_URL
}

export class TokenPrice {
  private coinGeckoApi: CoinGeckoApi | undefined
  private restClient: HttpRestClient

  constructor(
    network: Network,
    coinGeckoOptions: {
      baseUrl: string
      apiKey: string
    }
  ) {
    this.coinGeckoApi = new CoinGeckoApi(coinGeckoOptions)
    this.restClient = new HttpRestClient(getAssetMicroserviceEndpoint(network))
  }

  async fetchUsdTokensPrice(coinGeckoIds: string[] = []) {
    const {
      data: { data: prices }
    } = (await this.restClient.get('coin/prices')) as {
      data: { data: { id: string; current_price: number }[] }
    }

    const tokenPriceMap: Record<string, number> = prices.reduce(
      (prices, { id, current_price }) => ({ ...prices, [id]: current_price }),
      {}
    )

    const coinGeckoIdsToFetch = coinGeckoIds.filter(
      (coinGeckoId) => !tokenPriceMap[coinGeckoId]
    )

    if (coinGeckoIdsToFetch.length === 0) {
      return tokenPriceMap
    }

    const { denomPriceMap, coinGeckoIdList } = coinGeckoIdsToFetch.reduce(
      (lists, coinGeckoId: string) => {
        const isDenomFormat =
          coinGeckoId.startsWith('ibc/') ||
          coinGeckoId.startsWith('peggy') ||
          coinGeckoId.startsWith('share') ||
          coinGeckoId.startsWith('factory/')

        if (isDenomFormat) {
          return {
            ...lists,
            denomPriceMap: { ...lists.denomPriceMap, [coinGeckoId]: 0 }
          }
        }

        return {
          ...lists,
          coinGeckoIdList: [...lists.coinGeckoIdList, coinGeckoId]
        }
      },
      { denomPriceMap: {}, coinGeckoIdList: [] } as {
        denomPriceMap: Record<string, number>
        coinGeckoIdList: string[]
      }
    )

    const whiteListedCoinGeckoIdsToFetch = coinGeckoIdList.filter(
      (coinGeckoId) => whiteListedCoinGeckoIds.includes(coinGeckoId)
    )

    const coinGeckoIdsPriceMap =
      await this.fetchUsdTokenPriceFromCoinGeckoInChunks(
        whiteListedCoinGeckoIdsToFetch
      )

    const formattedCoinGeckoIdsPriceMap = Object.entries(
      coinGeckoIdsPriceMap
    ).reduce(
      (list, [key, value]) => ({ ...list, [key.toLowerCase()]: value }),
      {} as Record<string, number>
    )

    return {
      ...tokenPriceMap,
      ...formattedCoinGeckoIdsPriceMap,
      ...denomPriceMap
    }
  }

  private fetchUsdTokenPriceFromCoinGeckoNoThrow = async (coinId: string) => {
    if (!coinId) {
      return 0
    }

    if (!this.coinGeckoApi) {
      return 0
    }

    try {
      const priceInUsd = await this.coinGeckoApi.fetchUsdPrice(coinId)

      if (!priceInUsd) {
        return 0
      }

      return new BigNumberInBase(priceInUsd).toNumber()
    } catch (e: unknown) {
      return 0
    }
  }

  private fetchUsdTokenPriceFromCoinGeckoInChunks = async (
    coinIds: string[]
  ) => {
    const CHUNK_SIZE = 5
    const chunks = splitArrayToChunks({
      array: coinIds,
      chunkSize: CHUNK_SIZE,
      filter: (c) => !!c
    })

    /**
     * We make chunks to ensure that we don't hit the
     * rate limits on CoinGecko by querying multiple
     * prices at the same time as we do multiple
     * calls at the same time
     */
    const response = await Promise.all(
      chunks.map(async (chunk, index) => {
        let prices = {} as Record<string, number>

        for (let i = 0; i < chunk.length; i += 1) {
          const price = await this.fetchUsdTokenPriceFromCoinGeckoNoThrow(
            chunk[i]
          )

          prices[chunk[i]] = price
        }

        if (index < chunks.length - 1) {
          await sleep(500)
        }

        return prices
      })
    )

    const prices = response.reduce((prices, chunkResponse) => {
      return { ...prices, ...chunkResponse }
    }, {})

    return prices
  }
}
