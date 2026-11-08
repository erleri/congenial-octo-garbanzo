import CurrencyReportReview from '../components/CurrencyReportReview'
import AdminAccessPanel from '../components/AdminAccessPanel'
import { useAdminAccess } from '../hooks/useAdminAccess'

export default function DbReview() {
  const access = useAdminAccess()
  return <><AdminAccessPanel access={access}/>{access.canManage ? <CurrencyReportReview access={access}/> : null}</>
}
