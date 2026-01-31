import { describe, it, expect } from "vitest";
import { add, subtract, multiply, divide, factorial, fibonacci, isPrime } from "./math.js";

describe("Math functions", () => {
  describe("add", () => {
    it("adds two positive numbers", () => {
      expect(add(2, 3)).toBe(5);
    });

    it("adds negative numbers", () => {
      expect(add(-1, -2)).toBe(-3);
    });

    it("adds zero", () => {
      expect(add(5, 0)).toBe(5);
    });
  });

  describe("subtract", () => {
    it("subtracts two numbers", () => {
      expect(subtract(5, 3)).toBe(2);
    });

    it("handles negative results", () => {
      expect(subtract(3, 5)).toBe(-2);
    });
  });

  describe("multiply", () => {
    it("multiplies two numbers", () => {
      expect(multiply(3, 4)).toBe(12);
    });

    it("handles zero", () => {
      expect(multiply(5, 0)).toBe(0);
    });
  });

  describe("divide", () => {
    it("divides two numbers", () => {
      expect(divide(10, 2)).toBe(5);
    });

    it("throws on division by zero", () => {
      expect(() => divide(10, 0)).toThrow("Cannot divide by zero");
    });

    it("handles decimal results", () => {
      expect(divide(7, 2)).toBe(3.5);
    });
  });

  describe("factorial", () => {
    it("returns 1 for 0", () => {
      expect(factorial(0)).toBe(1);
    });

    it("returns 1 for 1", () => {
      expect(factorial(1)).toBe(1);
    });

    it("calculates factorial correctly", () => {
      expect(factorial(5)).toBe(120);
    });

    it("throws for negative numbers", () => {
      expect(() => factorial(-1)).toThrow();
    });
  });

  describe("fibonacci", () => {
    it("returns 0 for n=0", () => {
      expect(fibonacci(0)).toBe(0);
    });

    it("returns 1 for n=1", () => {
      expect(fibonacci(1)).toBe(1);
    });

    it("calculates fibonacci correctly", () => {
      expect(fibonacci(10)).toBe(55);
    });
  });

  describe("isPrime", () => {
    it("returns false for 0 and 1", () => {
      expect(isPrime(0)).toBe(false);
      expect(isPrime(1)).toBe(false);
    });

    it("returns true for prime numbers", () => {
      expect(isPrime(2)).toBe(true);
      expect(isPrime(3)).toBe(true);
      expect(isPrime(7)).toBe(true);
      expect(isPrime(13)).toBe(true);
    });

    it("returns false for non-prime numbers", () => {
      expect(isPrime(4)).toBe(false);
      expect(isPrime(9)).toBe(false);
      expect(isPrime(15)).toBe(false);
    });
  });
});
