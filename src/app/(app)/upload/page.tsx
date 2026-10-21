import UploadForm from '@/components/UploadForm'
import { allCategories, allKeywords } from '@/lib/db'
import { getStorage } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export default function UploadPage() {
  const storage = getStorage()
  return (
    <>
      <h1>添加资料</h1>
      <p className="sub">说明书、名片、发票、合同……图片会在浏览器里压缩后再上传，原图不会离开你的电脑；其他文件原样保存。</p>
      <UploadForm
        driver={storage.name}
        canPresign={storage.supportsPresign}
        // Offer words already in use so the same thing isn't tagged two ways.
        suggestions={allKeywords().map((k) => k.word)}
        categories={allCategories().map((c) => c.name)}
      />
    </>
  )
}
