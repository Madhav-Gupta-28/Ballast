// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @notice The DreamDEX binary pool surface Ballast uses.
 * @dev Signatures taken verbatim from `binaryPoolWriteAbi` in the
 *      markets-sdk 0.29.0 package (dist/tradeAbi.d.ts).
 */
interface IBinaryPool {
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
