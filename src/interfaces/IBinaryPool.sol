// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice The DreamDEX binary pool surface Ballast uses.
 * @dev Signatures taken verbatim from `binaryPoolWriteAbi` in the
 *      markets-sdk 0.29.0 package (dist/tradeAbi.d.ts).
 */
interface IBinaryPool {
    /**
     * @notice The pool's live parameters, including the CURRENT outcome ids.
     * @dev These must be read, never cached. Settlement-extraction v2 recycles a
     *      pool's (nonce -> ids) binding on every new window — a live testnet
     *      pool was already on marketNonce 98 — so ids stored at allowlist time
     *      go stale within minutes and the holder would silently read zero.
     */
    struct BinaryPoolParams {
        address collateralToken;
        address market;
        address outcomeToken;
        uint256 yesId;
        uint256 noId;
        uint256 oneCollateral;
        uint256 setBacking;
        address feeRecipient;
        uint256 makerFeeBpsTimes1k;
        uint256 takerFeeBpsTimes1k;
        uint256 maxBuilderFeeBpsTimes1k;
        uint256 settlementFeeBpsTimes1k;
        address settlement;
        uint64 marketNonce;
        bool finalized;
    }

    function getBinaryPoolParams() external view returns (BinaryPoolParams memory);

    /// @notice Pull `amount` collateral, mint `amount` YES to `yesTo` and NO to `noTo`.
    function mintSet(address yesTo, address noTo, uint256 amount) external;

    /// @notice Burn `amount` of each leg held by the caller, refund `amount` collateral.
    function burnSet(uint256 amount) external;

    /// @dev `payable` upstream because native-base sells can carry value; binary
    ///      markets are ERC-20 collateralised, so Ballast never sends value.
    function placeOrder(
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external returns (uint256 orderId);

    function cancelOrder(uint128 orderId) external;

    function cancelOrders(uint128[] calldata orderIds) external;
}
