import { createContext, use } from "react";

export interface DetailsPane {
  shown: boolean;
  toggle?: () => void;
}

export const DetailsPaneContext = createContext<DetailsPane>({ shown: false });

export function useDetailsPane(): DetailsPane {
  return use(DetailsPaneContext);
}
