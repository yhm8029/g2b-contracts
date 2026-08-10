import { ContractLookupApp } from "@/components/ContractLookupApp";

export default function HomePage() {
  return (
    <>
      <nav className="home-excellent-products-nav" aria-label="추가 조회 메뉴">
        <a href="/excellent-products">빌딩자동제어장치 조달우수업체 현황</a>
      </nav>
      <ContractLookupApp />
    </>
  );
}
