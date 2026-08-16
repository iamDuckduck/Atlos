import type { FC } from 'react';
import SearchShared, { type ExternalSearchProps } from './search.shared';

interface SearchMobileProps {
  width?: number | string; // allow parent to control width flexibly
  external?: ExternalSearchProps;
}

const SearchMobile: FC<SearchMobileProps> = ({ width = '100%', external }) => {
  return <SearchShared width={width} mobile external={external} />;
};

export default SearchMobile;
