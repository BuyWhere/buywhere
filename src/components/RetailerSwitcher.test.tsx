import { render, screen, fireEvent } from "@testing-library/react";
import { RetailerSwitcher, filterByRetailers } from "./RetailerSwitcher";

describe("RetailerSwitcher", () => {
  it("renders all retailers by default", () => {
    render(<RetailerSwitcher />);
    expect(screen.getByText("Amazon.com")).toBeInTheDocument();
    expect(screen.getByText("Walmart")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Best Buy")).toBeInTheDocument();
  });

  it("toggles retailer when clicked", () => {
    render(<RetailerSwitcher />);
    const walmartButton = screen.getByRole("button", { name: /hide prices from walmart/i });
    fireEvent.click(walmartButton);
    expect(screen.getByRole("button", { name: /show prices from walmart/i })).toBeInTheDocument();
  });

  it("calls onChange when retailer toggled", () => {
    const handleChange = jest.fn();
    render(<RetailerSwitcher onChange={handleChange} />);
    const targetButton = screen.getByRole("button", { name: /hide prices from target/i });
    fireEvent.click(targetButton);
    expect(handleChange).toHaveBeenCalledWith(["amazon", "walmart", "bestbuy"]);
  });

  it("select all enables all retailers", () => {
    render(<RetailerSwitcher />);
    const allButton = screen.getByRole("button", { name: /select all retailers/i });
    fireEvent.click(allButton);
    expect(screen.getByRole("button", { name: /hide prices from amazon/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide prices from walmart/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide prices from target/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide prices from best buy/i })).toBeInTheDocument();
  });

  it("has proper accessibility attributes", () => {
    render(<RetailerSwitcher />);
    const amazonButton = screen.getByRole("button", { name: /hide prices from amazon/i });
    expect(amazonButton).toHaveAttribute("aria-pressed", "true");
  });
});

describe("filterByRetailers", () => {
  const items = [
    { merchant: "Amazon.com", price: "100" },
    { merchant: "Walmart", price: "90" },
    { merchant: "Target", price: "95" },
    { merchant: "Best Buy", price: "105" },
  ];

  it("returns all items when no filter applied", () => {
    const result = filterByRetailers(items, []);
    expect(result).toHaveLength(4);
  });

  it("filters items by enabled retailers", () => {
    const result = filterByRetailers(items, ["amazon", "walmart"]);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.merchant)).toEqual(["Amazon.com", "Walmart"]);
  });

  it("handles unknown merchants gracefully", () => {
    const itemsWithUnknown = [...items, { merchant: "Unknown Store", price: "80" }];
    const result = filterByRetailers(itemsWithUnknown, ["amazon"]);
    expect(result).toHaveLength(2);
  });
});