import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Img } from "@/components/app";

afterEach(cleanup);

const OLD = "https://x.supabase.co/storage/v1/object/public/catalog-images/services/massage/1-aaaaaa.webp";
const NEW = "https://x.supabase.co/storage/v1/object/public/catalog-images/services/massage/2-bbbbbb.webp";

describe("Img : changement d'image", () => {
  it("affiche la nouvelle photo après l'échec de l'ancienne (même composant, src modifiée)", () => {
    const { rerender, container } = render(<Img src={OLD} alt="Massage" />);
    fireEvent.error(screen.getByRole("img", { name: "Massage" }));
    expect(container.querySelector("img")).toBeNull(); // repli affiché
    rerender(<Img src={NEW} alt="Massage" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(NEW);
  });

  it("une nouvelle photo qui échoue à son tour revient au repli, puis une autre est de nouveau essayée", () => {
    const { rerender, container } = render(<Img src={OLD} alt="Massage" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Img src={NEW} alt="Massage" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    rerender(<Img src={OLD} alt="Massage" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(OLD);
  });

  it("garde le repli tant que la src ne change pas", () => {
    const { rerender, container } = render(<Img src={OLD} alt="Massage" />);
    fireEvent.error(container.querySelector("img")!);
    rerender(<Img src={OLD} alt="Massage" />);
    expect(container.querySelector("img")).toBeNull();
  });
});
