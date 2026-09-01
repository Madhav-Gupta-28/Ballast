// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "solmate/tokens/ERC20.sol";
import {IOutcomeToken} from "../../src/interfaces/IOutcomeToken.sol";

/// @notice Collateral stand-in. Decimals are constructor-set so tests can run
///         the same assertions at 6dp (testnet tUSDC) and 18dp (mainnet USDso).
contract MockCollateral is ERC20 {
    constructor(uint8 d) ERC20("Mock Collateral", "mUSD", d) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal ERC-6909 singleton: balances keyed by (owner, id).
contract MockOutcomeToken is IOutcomeToken {
    mapping(address => mapping(uint256 => uint256)) internal _bal;
    mapping(address => mapping(address => bool)) internal _op;

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return _bal[owner][id];
    }

    function setOperator(address spender, bool approved) external returns (bool) {
        _op[msg.sender][spender] = approved;
        return true;
    }

    function isOperator(address owner, address spender) external view returns (bool) {
        return _op[owner][spender];
    }

    function mintTo(address to, uint256 id, uint256 amount) external {
        _bal[to][id] += amount;
    }

    function burnFrom(address from, uint256 id, uint256 amount) external {
        _bal[from][id] -= amount;
    }
}

/**
 * @notice A binary pool that honours the two rules that matter:
 *         one collateral in  -> one YES + one NO out
 *         one of each in     -> one collateral out
 *
 * Orders are recorded rather than matched; fills are driven explicitly from the
 * tests so each leg of a two-sided fill can be asserted separately.
 */
contract MockBinaryPool {
    MockCollateral public immutable collateral;
    MockOutcomeToken public immutable outcome;
    uint256 public immutable yesId;
    uint256 public immutable noId;

    struct Order {
        address maker;
        bool isBid;
        uint256 price;
        uint256 quantity;
        bool live;
    }

    Order[] public orders;

    constructor(MockCollateral _c, MockOutcomeToken _o, uint256 _yesId, uint256 _noId) {
        collateral = _c;
        outcome = _o;
        yesId = _yesId;
        noId = _noId;
    }

    function mintSet(address yesTo, address noTo, uint256 amount) external {
        collateral.transferFrom(msg.sender, address(this), amount);
        outcome.mintTo(yesTo, yesId, amount);
        outcome.mintTo(noTo, noId, amount);
    }

    function burnSet(uint256 amount) external {
        outcome.burnFrom(msg.sender, yesId, amount);
        outcome.burnFrom(msg.sender, noId, amount);
        collateral.transfer(msg.sender, amount);
    }

    function placeOrder(
        bool isBid,
        uint64,
        uint256 price,
        uint256 quantity,
        uint64,
        uint8,
        uint8,
        address,
        uint96
    ) external returns (uint256 orderId) {
        orders.push(Order({maker: msg.sender, isBid: isBid, price: price, quantity: quantity, live: true}));
        return orders.length - 1;
    }

    function cancelOrder(uint128 orderId) external {
        orders[orderId].live = false;
    }

    function cancelOrders(uint128[] calldata ids) external {
        for (uint256 i; i < ids.length; ++i) {
            orders[ids[i]].live = false;
        }
    }

    /// @notice Simulate a taker lifting the vault's ask on one leg.
    ///         The vault delivers `id` and receives `price * qty` collateral.
    function fillAsk(address maker, uint256 id, uint256 qty, uint256 proceeds) external {
        outcome.burnFrom(maker, id, qty);
        collateral.transfer(maker, proceeds);
    }

    function seed(uint256 amount) external {
        collateral.mint(address(this), amount);
    }

    function orderCount() external view returns (uint256) {
        return orders.length;
    }
}
